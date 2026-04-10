import Notification from "../models/Notification.js";

export async function createUserNotification({
  recipientId,
  actorId,
  type,
  title,
  body = "",
  data = {},
  io,
}) {
  if (!recipientId || !type || !title) {
    return null;
  }

  const notification = await Notification.create({
    recipient: recipientId,
    actor: actorId || undefined,
    type,
    title,
    body,
    data,
  });

  const populated = await notification.populate("actor", "username fullName profileImage");

  if (io) {
    io.to(`user:${recipientId.toString()}`).emit("notification:new", populated);
  }

  return populated;
}
