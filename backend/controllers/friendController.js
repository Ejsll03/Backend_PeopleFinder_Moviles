import User from "../models/User.js";
import FriendRequest from "../models/FriendRequest.js";
import { createUserNotification } from "../services/notifications.js";

export const getDiscoverUsers = async (req, res) => {
  try {
    const currentUser = req.user;
    const normalizeInterest = (value = "") =>
      String(value || "").trim().toLowerCase();
    const currentInterestSet = new Set(
      (Array.isArray(currentUser?.interests) ? currentUser.interests : [])
        .map((item) => normalizeInterest(item))
        .filter(Boolean)
    );

    const pendingRequests = await FriendRequest.find({
      $or: [{ requester: currentUser._id }, { recipient: currentUser._id }],
      status: "pending",
    }).select("requester recipient");

    const blockedIds = new Set([currentUser._id.toString()]);
    currentUser.friends.forEach((id) => blockedIds.add(id.toString()));
    pendingRequests.forEach((request) => {
      blockedIds.add(request.requester.toString());
      blockedIds.add(request.recipient.toString());
    });

    const users = await User.find({
      _id: { $nin: Array.from(blockedIds) },
    })
      .sort({ createdAt: -1 })
      .select("username fullName bio profileImage city interests privacySettings");

    const visibleUsers = users.map((user) => {
      const plain = user.toObject();
      const showCity = plain?.privacySettings?.showCity !== false;
      const interests = Array.isArray(plain?.interests) ? plain.interests : [];
      const sharedInterestsCount = interests.filter((item) =>
        currentInterestSet.has(normalizeInterest(item))
      ).length;

      if (!showCity) {
        plain.city = "";
      }

      return {
        ...plain,
        sharedInterestsCount,
      };
    });

    const sortedBySimilarity = [...visibleUsers].sort(
      (a, b) => (b.sharedInterestsCount || 0) - (a.sharedInterestsCount || 0)
    );

    const withSharedInterests = sortedBySimilarity.filter(
      (item) => (item.sharedInterestsCount || 0) > 0
    );

    res.json(withSharedInterests.length > 0 ? withSharedInterests : sortedBySimilarity);
  } catch (error) {
    res.status(500).json({ error: "No fue posible obtener sugerencias" });
  }
};

export const swipeFriend = async (req, res) => {
  try {
    const { targetUserId, direction } = req.body;
    const currentUserId = req.user._id;

    if (!targetUserId || !["left", "right"].includes(direction)) {
      return res
        .status(400)
        .json({ error: "targetUserId y direction(left|right) son requeridos" });
    }

    if (targetUserId === currentUserId.toString()) {
      return res.status(400).json({ error: "No puedes deslizarte a ti mismo" });
    }

    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ error: "Usuario objetivo no encontrado" });
    }

    const alreadyFriends = req.user.friends.some(
      (friendId) => friendId.toString() === targetUserId
    );

    if (alreadyFriends) {
      return res.json({ message: "Ya son amigos", status: "friends" });
    }

    const incomingPending = await FriendRequest.findOne({
      requester: targetUserId,
      recipient: currentUserId,
      status: "pending",
    });

    if (direction === "left") {
      if (incomingPending) {
        incomingPending.status = "rejected";
        incomingPending.respondedAt = new Date();
        await incomingPending.save();

        const io = req.app.get("io");
        await createUserNotification({
          recipientId: targetUserId,
          actorId: currentUserId,
          type: "system",
          title: "Solicitud rechazada",
          body: `${req.user.fullName || req.user.username} rechazó tu solicitud de amistad`,
          data: { status: "rejected", userId: currentUserId.toString() },
          io,
        });
      }

      return res.json({ message: "Deslizado a la izquierda", status: "rejected" });
    }

    const requestPermission =
      targetUser?.privacySettings?.friendRequestPermission || "everyone";

    if (!incomingPending && requestPermission === "nobody") {
      return res.status(403).json({
        error: "Este usuario no acepta solicitudes de amistad",
      });
    }

    if (!incomingPending && requestPermission === "friends_of_friends") {
      const currentFriendIds = new Set(
        (req.user.friends || []).map((id) => id.toString())
      );
      const hasMutualFriend = (targetUser.friends || []).some((id) =>
        currentFriendIds.has(id.toString())
      );

      if (!hasMutualFriend) {
        return res.status(403).json({
          error: "Este usuario solo acepta solicitudes de amigos de amigos",
        });
      }
    }

    if (incomingPending) {
      incomingPending.status = "accepted";
      incomingPending.respondedAt = new Date();
      await incomingPending.save();

      await User.findByIdAndUpdate(currentUserId, {
        $addToSet: { friends: targetUserId },
      });
      await User.findByIdAndUpdate(targetUserId, {
        $addToSet: { friends: currentUserId },
      });

      const io = req.app.get("io");

      await createUserNotification({
        recipientId: currentUserId,
        actorId: targetUserId,
        type: "friend_match",
        title: "Nueva amistad",
        body: `Ahora eres amigo de ${targetUser.fullName || targetUser.username}`,
        data: { userId: targetUser._id.toString() },
        io,
      });

      const currentUser = await User.findById(currentUserId).select(
        "username fullName"
      );

      await createUserNotification({
        recipientId: targetUserId,
        actorId: currentUserId,
        type: "friend_match",
        title: "Solicitud aceptada",
        body: `${currentUser?.fullName || currentUser?.username || "Un usuario"} aceptó tu solicitud`,
        data: { userId: currentUserId.toString() },
        io,
      });

      return res.json({
        message: "Amistad aceptada",
        status: "matched",
        friend: {
          id: targetUser._id,
          username: targetUser.username,
          fullName: targetUser.fullName,
          profileImage: targetUser.profileImage,
        },
      });
    }

    const existingOutgoing = await FriendRequest.findOne({
      requester: currentUserId,
      recipient: targetUserId,
      status: "pending",
    });

    if (!existingOutgoing) {
      await FriendRequest.create({
        requester: currentUserId,
        recipient: targetUserId,
      });

      const io = req.app.get("io");
      await createUserNotification({
        recipientId: targetUserId,
        actorId: currentUserId,
        type: "friend_request",
        title: "Nueva solicitud de amistad",
        body: `${req.user.fullName || req.user.username} quiere conectar contigo`,
        data: { userId: currentUserId.toString() },
        io,
      });
    }

    return res.json({ message: "Solicitud enviada", status: "pending" });
  } catch (error) {
    if (error.code === 11000) {
      return res.json({ message: "Solicitud ya existente", status: "pending" });
    }
    res.status(500).json({ error: "No fue posible procesar el swipe" });
  }
};

export const getFriendRequests = async (req, res) => {
  try {
    const requests = await FriendRequest.find({
      recipient: req.user._id,
      status: "pending",
    }).populate("requester", "username fullName profileImage bio");

    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: "No fue posible obtener solicitudes" });
  }
};

export const getFriends = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate(
      "friends",
      "username fullName profileImage bio city interests privacySettings"
    );

    res.json(user?.friends || []);
  } catch (error) {
    res.status(500).json({ error: "No fue posible obtener amistades" });
  }
};

export const getFriendDetail = async (req, res) => {
  try {
    const { friendId } = req.params;

    const user = await User.findById(req.user._id).select("friends");
    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const isFriend = (user.friends || []).some((id) => id.toString() === friendId);
    if (!isFriend) {
      return res.status(403).json({ error: "Solo puedes ver detalles de tus amistades" });
    }

    const friend = await User.findById(friendId).select(
      "username fullName profileImage bio city interests privacySettings"
    );

    if (!friend) {
      return res.status(404).json({ error: "Amigo no encontrado" });
    }

    return res.json(friend);
  } catch (error) {
    return res.status(500).json({ error: "No fue posible obtener el detalle del amigo" });
  }
};

export const removeFriend = async (req, res) => {
  try {
    const { friendId } = req.params;
    await User.findByIdAndUpdate(req.user._id, { $pull: { friends: friendId } });
    await User.findByIdAndUpdate(friendId, { $pull: { friends: req.user._id } });

    res.json({ message: "Amistad eliminada" });
  } catch (error) {
    res.status(500).json({ error: "No fue posible eliminar la amistad" });
  }
};
