import User from "../models/User.js";
import FriendRequest from "../models/FriendRequest.js";

export const getDiscoverUsers = async (req, res) => {
  try {
    const currentUser = req.user;

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
    }).select("username fullName bio profileImage");

    res.json(users);
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
      }

      return res.json({ message: "Deslizado a la izquierda", status: "rejected" });
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
      "username fullName profileImage bio"
    );

    res.json(user?.friends || []);
  } catch (error) {
    res.status(500).json({ error: "No fue posible obtener amistades" });
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
