import User from "../models/User.js";
import bcrypt from "bcrypt";
import {
  uploadBufferToGridFS,
  deleteGridFSFileByUrl,
} from "../services/gridfs.js";

export const register = async (req, res) => {
  try {
    const { username, email, password, fullName, bio = "" } = req.body;

    if (!username || !email || !password || !fullName) {
      return res.status(400).json({
        error: "username, email, password y fullName son requeridos",
      });
    }

    const exists = await User.findOne({
      $or: [{ username: username.trim() }, { email: email.trim() }],
    });
    if (exists) {
      return res
        .status(400)
        .json({ error: "Ya existe una cuenta con ese usuario o email" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const profileImage = await uploadBufferToGridFS(req.file, "profiles");

    const user = new User({
      username: username.trim(),
      email: email.trim().toLowerCase(),
      password: hashed,
      fullName: fullName.trim(),
      bio: bio?.trim() || "",
      profileImage,
    });
    await user.save();

    res.status(201).json({
      message: "Usuario registrado con éxito",
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        bio: user.bio,
        profileImage: user.profileImage,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const login = async (req, res) => {
  try {
    const { usernameOrEmail, password } = req.body;
    if (!usernameOrEmail || !password) {
      return res
        .status(400)
        .json({ error: "usernameOrEmail y password son requeridos" });
    }

    const user = await User.findOne({
      $or: [
        { username: usernameOrEmail.trim() },
        { email: usernameOrEmail.trim().toLowerCase() },
      ],
    });
    if (!user) {
      return res.status(400).json({ error: "Usuario no encontrado" });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: "Contraseña incorrecta" });
    }

    req.session.userId = user._id;
    req.session.username = user.username;
    req.session.email = user.email;
    req.session.fullName = user.fullName;
    req.session.profileImage = user.profileImage;
    req.session.isAuthenticated = true;
    req.session.loginTime = new Date().toISOString();

    res.json({ 
      message: "Login exitoso",
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        bio: user.bio,
        profileImage: user.profileImage,
      },
      sessionID: req.sessionID
    });
  } catch (err) {
    console.error("Error en login:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

// Endpoint para logout
export const logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Error al cerrar sesión" });
    }
    
    res.clearCookie('connect.sid');
    res.json({ message: "Logout exitoso" });
  });
};

// Endpoint para verificar sesión activa
export const checkAuth = (req, res) => {
  if (req.session.isAuthenticated) {
    res.json({
      isAuthenticated: true,
      user: {
        id: req.session.userId,
        username: req.session.username,
        email: req.session.email,
        fullName: req.session.fullName,
        profileImage: req.session.profileImage,
      }
    });
  } else {
    res.json({
      isAuthenticated: false
    });
  }
};

// Endpoint para reset password (placeholder)
export const resetPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email es requerido" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.json({ 
        message: "Si el email existe, se han enviado las instrucciones" 
      });
    }
    
    res.json({ 
      message: "Si el email existe, se han enviado las instrucciones"
    });
  } catch (err) {
    console.error("Error en reset password:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

// Endpoint para ver información detallada de la sesión
export const sessionInfo = (req, res) => {
  if (!req.session.isAuthenticated) {
    return res.status(401).json({ 
      error: "No autenticado",
      message: "Debes iniciar sesión para ver la información de sesión"
    });
  }
  
  // Calcular tiempo restante de sesión
  const expires = new Date(req.session.cookie.expires);
  const now = new Date();
  const timeRemaining = Math.floor((expires - now) / 1000);
  
  res.json({
    sessionID: req.sessionID,
    user: {
      id: req.session.userId,
      username: req.session.username,
      email: req.session.email,
      fullName: req.session.fullName,
      profileImage: req.session.profileImage,
    },
    sessionData: {
      isAuthenticated: req.session.isAuthenticated,
      loginTime: req.session.loginTime,
      cookie: {
        originalMaxAge: req.session.cookie.originalMaxAge,
        expires: req.session.cookie.expires,
        httpOnly: req.session.cookie.httpOnly,
        path: req.session.cookie.path
      }
    },
    mongoStoreInfo: {
      sessionCollection: "sessions",
      sessionExpires: req.session.cookie.expires,
      timeRemaining: timeRemaining > 0 ? `${timeRemaining} segundos` : "Expirada",
      timeRemainingSeconds: timeRemaining,
      status: timeRemaining > 0 ? "Activa" : "Expirada"
    },
    storage: {
      type: "MongoDB",
      collection: "sessions",
      persistence: "Sobrevive reinicios del servidor"
    }
  });
};

// Endpoint para debug de sesiones (solo desarrollo)
export const debugSessions = async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: "Endpoint no disponible en producción" });
    }

    const sessionStore = req.sessionStore;

    sessionStore.all((error, sessions) => {
      if (error) {
        return res.status(500).json({ error: "Error obteniendo sesiones" });
      }
      
      const sessionCount = Object.keys(sessions || {}).length;
      const activeSessions = sessions ? Object.entries(sessions).map(([id, session]) => ({
        sessionID: id,
        user: session.userId ? {
          id: session.userId,
          username: session.username,
        } : null,
        isAuthenticated: session.isAuthenticated || false,
        loginTime: session.loginTime || 'No disponible',
        expires: session.cookie?.expires
      })) : [];

      res.json({
        totalSessions: sessionCount,
        activeSessions: activeSessions,
        storage: {
          type: "MongoDB",
          collection: "sessions",
          status: sessionStore ? "Conectado" : "Error"
        }
      });
    });
  } catch (error) {
    console.error("Error en debugSessions:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

// Endpoint para ver estadísticas de sesiones
export const sessionStats = (req, res) => {
  if (!req.session.isAuthenticated) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const sessionAge = Math.floor((new Date() - new Date(req.session.loginTime)) / 1000);
  const expires = new Date(req.session.cookie.expires);
  const timeRemaining = Math.floor((expires - new Date()) / 1000);

  res.json({
    currentSession: {
      user: req.session.username,
      sessionID: req.sessionID,
      sessionAge: `${sessionAge} segundos`,
      timeRemaining: `${timeRemaining} segundos`,
      loginTime: req.session.loginTime
    },
    system: {
      sessionStorage: "MongoDB",
      cookieSettings: {
        httpOnly: req.session.cookie.httpOnly,
        secure: req.session.cookie.secure,
        maxAge: req.session.cookie.originalMaxAge
      }
    }
  });
};

// Obtener perfil del usuario autenticado
export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).select("-password");

    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    res.json({ user });
  } catch (error) {
    console.error("Error al obtener perfil:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

// Actualizar perfil del usuario autenticado
export const updateProfile = async (req, res) => {
  try {
    const { username, email, password, fullName, bio } = req.body;

    const updates = {};
    if (username) updates.username = username.trim();
    if (email) updates.email = email.trim().toLowerCase();
    if (fullName) updates.fullName = fullName.trim();
    if (typeof bio === "string") updates.bio = bio.trim();
    const currentUser = await User.findById(req.session.userId).select("profileImage");
    if (!currentUser) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    if (req.file) {
      updates.profileImage = await uploadBufferToGridFS(req.file, "profiles");
    }

    if (password) {
      updates.password = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No hay datos para actualizar" });
    }

    const user = await User.findByIdAndUpdate(req.session.userId, updates, {
      new: true,
      runValidators: true,
    }).select("-password");
    if (req.file && currentUser.profileImage) {
      await deleteGridFSFileByUrl(currentUser.profileImage);
    }


    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    // Actualizar datos de sesión
    req.session.username = user.username;
    req.session.email = user.email;
    req.session.fullName = user.fullName;
    req.session.profileImage = user.profileImage;

    res.json({
      message: "Perfil actualizado con éxito",
      user,
    });
  } catch (error) {
    console.error("Error al actualizar perfil:", error);

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || "campo";
      return res
        .status(400)
        .json({ error: `Ya existe un usuario con ese ${field}` });
    }

    res.status(500).json({ error: "Error interno del servidor" });
  }
};

// Eliminar cuenta del usuario autenticado
export const deleteAccount = async (req, res) => {
  try {
    const userId = req.session.userId;

    if (!userId) {
      return res.status(401).json({ error: "No autenticado" });
    }

    const deleted = await User.findByIdAndDelete(userId);
    if (deleted.profileImage) {
      await deleteGridFSFileByUrl(deleted.profileImage);
    }


    if (!deleted) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    req.session.destroy((err) => {
      if (err) {
        return res
          .status(500)
          .json({ error: "Cuenta eliminada, pero error al cerrar sesión" });
      }

      res.clearCookie("connect.sid");
      res.json({ message: "Cuenta eliminada correctamente" });
    });
  } catch (error) {
    console.error("Error al eliminar cuenta:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

export const deleteProfileImage = async (req, res) => {
  try {
    const existingUser = await User.findById(req.session.userId).select("profileImage");
    if (!existingUser) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const user = await User.findByIdAndUpdate(
      req.session.userId,
      { profileImage: "" },
      { new: true }
    ).select("-password");

    if (existingUser.profileImage) {
      await deleteGridFSFileByUrl(existingUser.profileImage);
    }

    req.session.profileImage = "";

    res.json({
      message: "Imagen de perfil eliminada",
      user,
    });
  } catch (error) {
    res.status(500).json({ error: "Error interno del servidor" });
  }
};