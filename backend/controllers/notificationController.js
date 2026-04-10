import mongoose from "mongoose";
import Notification from "../models/Notification.js";

export async function listNotifications(req, res) {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);
    const skip = (page - 1) * limit;

    const notifications = await Notification.find({ recipient: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("actor", "username fullName profileImage");

    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: "No fue posible obtener notificaciones" });
  }
}

export async function getUnreadCount(req, res) {
  try {
    const unreadCount = await Notification.countDocuments({
      recipient: req.user._id,
      isRead: false,
    });

    res.json({ unreadCount });
  } catch (error) {
    res.status(500).json({ error: "No fue posible obtener no leidas" });
  }
}

export async function markNotificationAsRead(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Id de notificación inválido" });
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: id, recipient: req.user._id },
      { isRead: true, readAt: new Date() },
      { new: true }
    ).populate("actor", "username fullName profileImage");

    if (!notification) {
      return res.status(404).json({ error: "Notificación no encontrada" });
    }

    res.json(notification);
  } catch (error) {
    res.status(500).json({ error: "No fue posible actualizar notificación" });
  }
}

export async function markAllNotificationsAsRead(req, res) {
  try {
    await Notification.updateMany(
      { recipient: req.user._id, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    res.json({ message: "Todas las notificaciones fueron marcadas como leídas" });
  } catch (error) {
    res.status(500).json({ error: "No fue posible marcar notificaciones" });
  }
}

export async function deleteNotification(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Id de notificación inválido" });
    }

    const deleted = await Notification.findOneAndDelete({
      _id: id,
      recipient: req.user._id,
    });

    if (!deleted) {
      return res.status(404).json({ error: "Notificación no encontrada" });
    }

    res.json({ message: "Notificación eliminada" });
  } catch (error) {
    res.status(500).json({ error: "No fue posible eliminar la notificación" });
  }
}
