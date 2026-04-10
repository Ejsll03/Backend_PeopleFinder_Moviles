import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import {
  uploadBufferToGridFS,
  deleteGridFSFileByUrl,
} from "../services/gridfs.js";

async function ensureParticipant(chatId, userId) {
  return Chat.findOne({ _id: chatId, participants: userId });
}

export async function listChats(req, res) {
  try {
    const chats = await Chat.find({ participants: req.user._id })
      .sort({ lastMessageAt: -1 })
      .populate("participants", "username fullName profileImage");

    res.json(chats);
  } catch (error) {
    res.status(500).json({ error: "No fue posible obtener chats" });
  }
}

export async function getChat(req, res) {
  try {
    const chat = await ensureParticipant(req.params.id, req.user._id);
    if (!chat) {
      return res.status(404).json({ error: "Chat no encontrado" });
    }

    const messages = await Message.find({ chat: chat._id })
      .sort({ createdAt: 1 })
      .populate("sender", "username fullName profileImage");

    res.json({ chat, messages });
  } catch (error) {
    res.status(500).json({ error: "No fue posible obtener el chat" });
  }
}

export async function createChat(req, res) {
  try {
    const { friendId } = req.body;
    if (!friendId) {
      return res.status(400).json({ error: "friendId es requerido" });
    }

    const user = await User.findById(req.user._id);
    const isFriend = user.friends.some((id) => id.toString() === friendId);
    if (!isFriend) {
      return res.status(403).json({ error: "Solo puedes chatear con amistades" });
    }

    let chat = await Chat.findOne({
      participants: { $all: [req.user._id, friendId], $size: 2 },
    }).populate("participants", "username fullName profileImage");

    if (!chat) {
      chat = await Chat.create({ participants: [req.user._id, friendId] });
      chat = await chat.populate("participants", "username fullName profileImage");
    }

    res.status(201).json(chat);
  } catch (error) {
    res.status(500).json({ error: "No fue posible crear el chat" });
  }
}

export async function sendMessage(req, res) {
  try {
    const chat = await ensureParticipant(req.params.id, req.user._id);
    if (!chat) {
      return res.status(404).json({ error: "Chat no encontrado" });
    }

    const text = (req.body.text || "").trim();
    const uploadedImage = await uploadBufferToGridFS(req.file, "chat");
    const imageUrl = uploadedImage || (req.body.imageUrl || "").trim();

    if (!text && !imageUrl) {
      return res.status(400).json({ error: "Debes enviar texto o imagen" });
    }

    const type = imageUrl ? "image" : "text";
    const message = await Message.create({
      chat: chat._id,
      sender: req.user._id,
      type,
      text,
      imageUrl,
      readBy: [req.user._id],
    });

    chat.lastMessage = type === "image" ? "[Imagen]" : text;
    chat.lastMessageAt = new Date();
    await chat.save();

    const populatedMessage = await message.populate(
      "sender",
      "username fullName profileImage"
    );

    if (req.app.get("io")) {
      req.app.get("io").to(`chat:${chat._id.toString()}`).emit("new_message", {
        chatId: chat._id,
        message: populatedMessage,
      });
    }

    res.status(201).json(populatedMessage);
  } catch (error) {
    res.status(500).json({ error: "No fue posible enviar el mensaje" });
  }
}

export async function deleteChat(req, res) {
  try {
    const chat = await ensureParticipant(req.params.id, req.user._id);
    if (!chat) {
      return res.status(404).json({ error: "Chat no encontrado" });
    }

    const chatMessages = await Message.find({ chat: chat._id }).select("imageUrl");

    await Message.deleteMany({ chat: chat._id });
    await Chat.findByIdAndDelete(chat._id);

    for (const message of chatMessages) {
      if (message.imageUrl) {
        await deleteGridFSFileByUrl(message.imageUrl);
      }
    }

    res.json({ message: "Chat eliminado" });
  } catch (error) {
    res.status(500).json({ error: "No fue posible eliminar el chat" });
  }
}

export async function listChatMessages(req, res) {
  try {
    const chat = await ensureParticipant(req.params.id, req.user._id);
    if (!chat) {
      return res.status(404).json({ error: "Chat no encontrado" });
    }

    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 30);
    const skip = (page - 1) * limit;

    const messages = await Message.find({ chat: chat._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("sender", "username fullName profileImage");

    res.json(messages.reverse());
  } catch (error) {
    res.status(500).json({ error: "No fue posible obtener mensajes" });
  }
}

export async function markChatAsRead(req, res) {
  try {
    const chat = await ensureParticipant(req.params.id, req.user._id);
    if (!chat) {
      return res.status(404).json({ error: "Chat no encontrado" });
    }

    await Message.updateMany(
      { chat: chat._id, readBy: { $ne: req.user._id } },
      { $addToSet: { readBy: req.user._id } }
    );

    res.json({ message: "Mensajes marcados como leidos" });
  } catch (error) {
    res.status(500).json({ error: "No fue posible actualizar estado de lectura" });
  }
}

export async function getUnreadSummary(req, res) {
  try {
    const chats = await Chat.find({ participants: req.user._id });
    const chatIds = chats.map((chat) => chat._id);

    const unread = await Message.countDocuments({
      chat: { $in: chatIds },
      sender: { $ne: req.user._id },
      readBy: { $ne: req.user._id },
    });

    res.json({ unreadMessages: unread });
  } catch (error) {
    res.status(500).json({ error: "No fue posible obtener no leidos" });
  }
}
