import User from "../models/User.js";
import bcrypt from "bcrypt";
import crypto from "crypto";
import {
  uploadBufferToGridFS,
  deleteGridFSFileByUrl,
} from "../services/gridfs.js";
import { sendEmailVerification, sendPasswordResetEmail } from "../services/mailer.js";

function parseInterests(rawInterests) {
  if (Array.isArray(rawInterests)) {
    return rawInterests
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }

  if (typeof rawInterests === "string") {
    const trimmed = rawInterests.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean);
      }
    } catch (_error) {
      return trimmed
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }

  return [];
}

const DEFAULT_PRIVACY_SETTINGS = {
  profileVisibility: "public",
  friendRequestPermission: "everyone",
  messagePermission: "friends",
  appearanceMode: "dark",
  showCity: true,
  showOnlineStatus: true,
  showReadReceipts: true,
  showLastSeen: true,
};

function normalizePrivacySettings(raw = {}) {
  const profileVisibilityOptions = ["public", "friends", "private"];
  const friendRequestOptions = ["everyone", "friends_of_friends", "nobody"];
  const messageOptions = ["everyone", "friends"];
  const appearanceOptions = ["dark", "light"];

  const settings = {
    ...DEFAULT_PRIVACY_SETTINGS,
    ...(raw || {}),
  };

  if (!profileVisibilityOptions.includes(settings.profileVisibility)) {
    settings.profileVisibility = DEFAULT_PRIVACY_SETTINGS.profileVisibility;
  }
  if (!friendRequestOptions.includes(settings.friendRequestPermission)) {
    settings.friendRequestPermission =
      DEFAULT_PRIVACY_SETTINGS.friendRequestPermission;
  }
  if (!messageOptions.includes(settings.messagePermission)) {
    settings.messagePermission = DEFAULT_PRIVACY_SETTINGS.messagePermission;
  }
  if (!appearanceOptions.includes(settings.appearanceMode)) {
    settings.appearanceMode = DEFAULT_PRIVACY_SETTINGS.appearanceMode;
  }

  settings.showCity = Boolean(settings.showCity);
  settings.showOnlineStatus = Boolean(settings.showOnlineStatus);
  settings.showReadReceipts = Boolean(settings.showReadReceipts);
  settings.showLastSeen = Boolean(settings.showLastSeen);

  return settings;
}

function buildEmailVerificationPayload() {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  return {
    token,
    tokenHash,
    expires,
  };
}

function buildPasswordResetPayload() {
  const token = crypto.randomBytes(3).toString("hex").toUpperCase();
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expires = new Date(Date.now() + 60 * 60 * 1000);

  return {
    token,
    tokenHash,
    expires,
  };
}

async function dispatchVerificationEmail(user, token) {
  try {
    await sendEmailVerification({
      to: user.email,
      fullName: user.fullName,
      token,
    });
    return { sent: true };
  } catch (error) {
    console.error("No fue posible enviar el email de verificación:", error.message);
    return { sent: false, error: error.message };
  }
}

export const register = async (req, res) => {
  try {
    const { username, email, password, fullName, city = "", bio = "", interests } = req.body;

    if (!username || !email || !password || !fullName) {
      return res.status(400).json({
        error: "username, email, password y fullName son requeridos",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "La imagen de perfil es obligatoria",
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
    const verification = buildEmailVerificationPayload();

    const profileImage = await uploadBufferToGridFS(req.file, "profiles");

    const user = new User({
      username: username.trim(),
      email: email.trim().toLowerCase(),
      password: hashed,
      fullName: fullName.trim(),
      city: city?.trim() || "",
      bio: bio?.trim() || "",
      interests: parseInterests(interests),
      emailVerified: false,
      emailVerificationToken: verification.tokenHash,
      emailVerificationExpires: verification.expires,
      privacySettings: DEFAULT_PRIVACY_SETTINGS,
      profileImage,
    });
    await user.save();

    const verificationEmail = await dispatchVerificationEmail(user, verification.token);

    res.status(201).json({
      message: verificationEmail.sent
        ? "Usuario registrado. Revisa tu correo para verificar tu cuenta"
        : "Usuario registrado. No se pudo enviar el correo de verificación",
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        city: user.city,
        bio: user.bio,
        interests: user.interests,
        emailVerified: user.emailVerified,
        privacySettings: normalizePrivacySettings(user.privacySettings),
        profileImage: user.profileImage,
      },
      emailVerificationSent: verificationEmail.sent,
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
    req.session.city = user.city;
    req.session.profileImage = user.profileImage;
    req.session.emailVerified = user.emailVerified;
    req.session.privacySettings = normalizePrivacySettings(user.privacySettings);
    req.session.isAuthenticated = true;
    req.session.loginTime = new Date().toISOString();

    res.json({ 
      message: "Login exitoso",
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        city: user.city,
        bio: user.bio,
        interests: user.interests,
        emailVerified: user.emailVerified,
        privacySettings: normalizePrivacySettings(user.privacySettings),
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
        city: req.session.city,
        emailVerified: Boolean(req.session.emailVerified),
        privacySettings: normalizePrivacySettings(req.session.privacySettings),
        profileImage: req.session.profileImage,
      }
    });
  } else {
    res.json({
      isAuthenticated: false
    });
  }
};

// Endpoint para solicitar token de recuperación
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

    const resetPayload = buildPasswordResetPayload();
    user.passwordResetToken = resetPayload.tokenHash;
    user.passwordResetExpires = resetPayload.expires;
    await user.save();

    await sendPasswordResetEmail({
      to: user.email,
      fullName: user.fullName,
      token: resetPayload.token,
    });
    
    res.json({ 
      message: "Si el email existe, se han enviado las instrucciones"
    });
  } catch (err) {
    console.error("Error en reset password:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

export const verifyResetToken = async (req, res) => {
  try {
    const token = (req.query.token || req.body?.token || "").toString().trim().toUpperCase();
    if (!token) {
      return res.status(400).json({ error: "Token de recuperación requerido" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
      passwordResetToken: tokenHash,
      passwordResetExpires: { $gt: new Date() },
    }).select("_id");

    if (!user) {
      return res.status(400).json({ error: "Token inválido o expirado" });
    }

    return res.json({ message: "Token válido" });
  } catch (error) {
    console.error("Error al verificar token de recuperación:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

export const confirmResetPassword = async (req, res) => {
  try {
    const token = (req.body?.token || "").toString().trim().toUpperCase();
    const newPassword = (req.body?.newPassword || "").toString();

    if (!token || !newPassword) {
      return res.status(400).json({ error: "token y newPassword son requeridos" });
    }

    if (newPassword.length < 6) {
      return res
        .status(400)
        .json({ error: "La nueva contraseña debe tener al menos 6 caracteres" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
      passwordResetToken: tokenHash,
      passwordResetExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ error: "Token inválido o expirado" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordResetToken = "";
    user.passwordResetExpires = undefined;
    await user.save();

    return res.json({ message: "Contraseña actualizada correctamente" });
  } catch (error) {
    console.error("Error al confirmar recuperación de contraseña:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
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
      city: req.session.city,
      emailVerified: Boolean(req.session.emailVerified),
      privacySettings: normalizePrivacySettings(req.session.privacySettings),
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
    const { username, email, password, fullName, city, bio, interests } = req.body;

    const updates = {};
    if (username) updates.username = username.trim();
    if (email) updates.email = email.trim().toLowerCase();
    if (fullName) updates.fullName = fullName.trim();
    if (typeof city === "string") updates.city = city.trim();
    if (typeof bio === "string") updates.bio = bio.trim();
    if (typeof interests !== "undefined") updates.interests = parseInterests(interests);
    const currentUser = await User.findById(req.session.userId).select(
      "profileImage email fullName"
    );
    if (!currentUser) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    let shouldSendVerification = false;
    let verificationToken;

    if (updates.email && updates.email !== currentUser.email) {
      const verification = buildEmailVerificationPayload();
      updates.emailVerified = false;
      updates.emailVerificationToken = verification.tokenHash;
      updates.emailVerificationExpires = verification.expires;
      shouldSendVerification = true;
      verificationToken = verification.token;
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
    req.session.city = user.city;
    req.session.emailVerified = user.emailVerified;
    req.session.privacySettings = normalizePrivacySettings(user.privacySettings);
    req.session.profileImage = user.profileImage;

    let verificationEmailSent = false;
    if (shouldSendVerification) {
      const verificationEmail = await dispatchVerificationEmail(
        user,
        verificationToken
      );
      verificationEmailSent = verificationEmail.sent;
    }

    res.json({
      message: "Perfil actualizado con éxito",
      user,
      emailVerificationSent: verificationEmailSent,
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

export const getPrivacySettings = async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).select("privacySettings");
    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    return res.json({
      privacySettings: normalizePrivacySettings(user.privacySettings),
    });
  } catch (error) {
    return res.status(500).json({ error: "No fue posible obtener la privacidad" });
  }
};

export const updatePrivacySettings = async (req, res) => {
  try {
    const input = req.body?.privacySettings || req.body || {};
    const normalized = normalizePrivacySettings(input);

    const user = await User.findByIdAndUpdate(
      req.session.userId,
      { privacySettings: normalized },
      { new: true, runValidators: true }
    ).select("privacySettings");

    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    req.session.privacySettings = normalizePrivacySettings(user.privacySettings);

    return res.json({
      message: "Privacidad actualizada",
      privacySettings: normalizePrivacySettings(user.privacySettings),
    });
  } catch (error) {
    return res.status(500).json({ error: "No fue posible actualizar la privacidad" });
  }
};

export const verifyEmailToken = async (req, res) => {
  try {
    const token = (req.query.token || req.body?.token || "").toString().trim();
    if (!token) {
      return res.status(400).json({ error: "Token de verificación requerido" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
      emailVerificationToken: tokenHash,
      emailVerificationExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ error: "Token inválido o expirado" });
    }

    user.emailVerified = true;
    user.emailVerificationToken = "";
    user.emailVerificationExpires = undefined;
    await user.save();

    if (req.session?.userId?.toString() === user._id.toString()) {
      req.session.emailVerified = true;
    }

    return res.json({
      message: "Correo verificado correctamente",
      user: {
        id: user._id,
        email: user.email,
        emailVerified: user.emailVerified,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: "No fue posible verificar el correo" });
  }
};

export const resendVerificationEmail = async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    if (user.emailVerified) {
      return res.json({ message: "Tu correo ya está verificado", emailVerified: true });
    }

    const verification = buildEmailVerificationPayload();
    user.emailVerificationToken = verification.tokenHash;
    user.emailVerificationExpires = verification.expires;
    await user.save();

    const verificationEmail = await dispatchVerificationEmail(user, verification.token);

    if (!verificationEmail.sent) {
      return res.status(500).json({
        error: "No se pudo reenviar el correo de verificación",
      });
    }

    return res.json({
      message: "Correo de verificación reenviado",
      emailVerified: false,
    });
  } catch (error) {
    return res.status(500).json({ error: "No fue posible reenviar la verificación" });
  }
};

export const verifyResetToken = async (req, res) => {
  try {
    const token = (req.query.token || req.body?.token || "").toString().trim();
    if (!token) {
      return res.status(400).json({ error: "Token requerido" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      passwordResetToken: tokenHash,
      passwordResetExpires: { $gt: new Date() },
    }).select("_id");

    if (!user) {
      return res.status(400).json({ error: "Token inválido o expirado" });
    }

    return res.json({ valid: true });
  } catch (error) {
    return res.status(500).json({ error: "No fue posible validar el token" });
  }
};

export const confirmResetPassword = async (req, res) => {
  try {
    const token = (req.body?.token || "").toString().trim();
    const newPassword = (req.body?.newPassword || "").toString();

    if (!token || !newPassword) {
      return res.status(400).json({ error: "token y newPassword son requeridos" });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      passwordResetToken: tokenHash,
      passwordResetExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ error: "Token inválido o expirado" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordResetToken = "";
    user.passwordResetExpires = undefined;
    await user.save();

    return res.json({ message: "Contraseña actualizada correctamente" });
  } catch (error) {
    return res.status(500).json({ error: "No fue posible restablecer la contraseña" });
  }
};