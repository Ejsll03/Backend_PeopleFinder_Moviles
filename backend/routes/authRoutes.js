import express from "express";
import { 
  register, 
  login, 
  logout, 
  checkAuth, 
  resetPassword,
  verifyResetToken,
  confirmResetPassword,
  sessionInfo,
  debugSessions,
  sessionStats,
  getProfile,
  updateProfile,
  deleteAccount,
  deleteProfileImage,
  verifyEmailToken,
  resendVerificationEmail,
  getPrivacySettings,
  updatePrivacySettings,
} from "../controllers/authController.js";
import { requireAuth } from "../middleware/auth.js";
import { uploadProfileImage } from "../middleware/upload.js";

const router = express.Router();

// Rutas de autenticación principales
router.post("/register", uploadProfileImage.single("profileImage"), register);
router.post("/login", login);
router.post("/logout", logout);
router.get("/check", checkAuth);
router.post("/reset-password", resetPassword);
router.get("/reset-password/verify", verifyResetToken);
router.post("/reset-password/confirm", confirmResetPassword);
router.get("/verify-email", verifyEmailToken);
router.post("/verify-email", verifyEmailToken);
router.post("/resend-verification", requireAuth, resendVerificationEmail);
router.get("/privacy", requireAuth, getPrivacySettings);
router.put("/privacy", requireAuth, updatePrivacySettings);

// Rutas de información y debug de sesiones
router.get("/session-info", sessionInfo);
router.get("/session-stats", sessionStats);
router.get("/debug-sessions", debugSessions);

// Rutas de perfil de usuario (requieren autenticación)
router.get("/profile", requireAuth, getProfile);
router.put(
  "/profile",
  requireAuth,
  uploadProfileImage.single("profileImage"),
  updateProfile
);
router.delete("/profile/image", requireAuth, deleteProfileImage);
router.delete("/profile", requireAuth, deleteAccount);

export default router;