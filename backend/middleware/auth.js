import User from "../models/User.js";

export const requireAuth = async (req, res, next) => {
  if (req.session && req.session.userId) {
    try {
      console.log("🔐 requireAuth -> sessionId:", req.sessionID, "userId:", req.session.userId);

      const user = await User.findById(req.session.userId).select("-password");
      if (!user) {
        console.warn("requireAuth: usuario no encontrado para userId", req.session.userId);
        return res
          .status(401)
          .json({ error: "No autenticado - Usuario no encontrado" });
      }

      req.user = user;
      next();
    } catch (error) {
      console.error("Error en middleware de autenticación:", error);

      if (error.name === "CastError") {
        console.warn(
          "requireAuth: sesión con userId inválido, destruyendo sesión y devolviendo 401"
        );
        if (req.session) {
          req.session.destroy(() => {});
        }
        return res
          .status(401)
          .json({ error: "No autenticado - Sesión inválida" });
      }

      return res
        .status(500)
        .json({ error: "Error del servidor al verificar la autenticación" });
    }
  } else {
    return res
      .status(401)
      .json({ error: "No autenticado - Sin sesión" });
  }
};
