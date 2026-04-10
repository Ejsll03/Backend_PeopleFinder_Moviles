import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import session from "express-session";
import MongoStore from "connect-mongo";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import authRoutes from "./routes/authRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import friendRoutes from "./routes/friendRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import Chat from "./models/Chat.js";
import Message from "./models/Message.js";
import { initGridFS, streamGridFSFile } from "./services/gridfs.js";
import { createUserNotification } from "./services/notifications.js";

dotenv.config();
const app = express();
const httpServer = createServer(app);

// Middlewares
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: "5mb" }));

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "dev-secret",
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    collectionName: "sessions",
    ttl: 60 * 60,
    autoRemove: "native",
  }),
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 60 * 60 * 1000,
  },
});

app.use(sessionMiddleware);

// Middleware de logging
app.use((req, res, next) => {
  console.log(
    `📡 ${req.method} ${req.url} - Session: ${
      req.sessionID
    } - ${new Date().toISOString()}`
  );
  next();
});

// Rutas del negocio social
app.use("/auth", authRoutes);
app.use("/chats", chatRoutes);
app.use("/friends", friendRoutes);
app.use("/notifications", notificationRoutes);

app.get("/media/:fileId", async (req, res) => {
  try {
    const found = await streamGridFSFile(req.params.fileId, res);
    if (!found) {
      return res.status(404).json({ error: "Archivo no encontrado" });
    }
  } catch (error) {
    return res.status(500).json({ error: "No fue posible obtener el archivo" });
  }
});

app.use((err, _req, res, next) => {
  if (err?.message === "Solo se permiten imagenes") {
    return res.status(400).json({ error: err.message });
  }

  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "La imagen excede el tamano permitido" });
  }

  return next(err);
});

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: true,
    credentials: true,
  },
});

app.set("io", io);

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

io.use((socket, next) => {
  const userId = socket.request.session?.userId;
  if (!userId) {
    return next(new Error("No autenticado"));
  }
  socket.userId = userId.toString();
  return next();
});

io.on("connection", (socket) => {
  socket.join(`user:${socket.userId}`);

  socket.on("join_chat", async ({ chatId }) => {
    const chat = await Chat.findOne({ _id: chatId, participants: socket.userId });
    if (chat) {
      socket.join(`chat:${chatId}`);
    }
  });

  socket.on("send_message", async ({ chatId, text = "", imageUrl = "" }) => {
    try {
      const chat = await Chat.findOne({ _id: chatId, participants: socket.userId });
      if (!chat) {
        socket.emit("chat_error", { message: "Chat no encontrado" });
        return;
      }

      const cleanText = (text || "").trim();
      const cleanImage = (imageUrl || "").trim();
      if (!cleanText && !cleanImage) {
        socket.emit("chat_error", { message: "Mensaje vacio" });
        return;
      }

      const message = await Message.create({
        chat: chat._id,
        sender: socket.userId,
        type: cleanImage ? "image" : "text",
        text: cleanText,
        imageUrl: cleanImage,
        readBy: [socket.userId],
      });

      chat.lastMessage = cleanImage ? "[Imagen]" : cleanText;
      chat.lastMessageAt = new Date();
      await chat.save();

      const populatedMessage = await message.populate(
        "sender",
        "username fullName profileImage"
      );

      io.to(`chat:${chat._id.toString()}`).emit("new_message", {
        chatId: chat._id,
        message: populatedMessage,
      });

      chat.participants.forEach((participantId) => {
        io.to(`user:${participantId.toString()}`).emit("chat_updated", {
          chatId: chat._id,
          lastMessage: chat.lastMessage,
          lastMessageAt: chat.lastMessageAt,
        });
      });

      const senderName =
        populatedMessage?.sender?.fullName ||
        populatedMessage?.sender?.username ||
        "Nuevo mensaje";
      const recipients = chat.participants
        .map((id) => id.toString())
        .filter((id) => id !== socket.userId);

      for (const recipientId of recipients) {
        await createUserNotification({
          recipientId,
          actorId: socket.userId,
          type: "message",
          title: "Nuevo mensaje",
          body: `${senderName}: ${cleanImage ? "[Imagen]" : cleanText}`,
          data: { chatId: chat._id.toString() },
          io,
        });
      }
    } catch (error) {
      socket.emit("chat_error", { message: "No fue posible enviar mensaje" });
    }
  });
});

// Conectar a MongoDB
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("Error: MONGODB_URI no está definido");
  process.exit(1);
}

// Función para configurar la base de datos
async function setupDatabase() {
  try {
    // Aquí podrías crear datos de prueba si lo necesitas.
    // De momento no se crea ningún usuario por defecto para evitar errores.
    console.log("Base de datos lista");
  } catch (error) {
    console.error("Error configurando la base de datos:", error.message);
  }
}

// Conectar a MongoDB
mongoose
  .connect(MONGODB_URI)
  .then(async () => {
    console.log("Conectado a MongoDB Atlas");

    initGridFS();
    await setupDatabase();

    httpServer.listen(PORT, () => {
      console.log(`Servidor corriendo en http://localhost:${PORT}`);
      console.log("Sesiones almacenadas en MongoDB");
      console.log("Socket.IO habilitado para chat en vivo");
    });
  })
  .catch((err) => {
    console.error("Error de conexión a MongoDB:", err.message);
    process.exit(1);
  });
