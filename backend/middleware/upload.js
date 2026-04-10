import multer from "multer";

function imageFilter(_req, file, cb) {
  const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
  if (!allowed.includes(file.mimetype)) {
    return cb(new Error("Solo se permiten imagenes"));
  }
  cb(null, true);
}

const memoryStorage = multer.memoryStorage();

export const uploadProfileImage = multer({
  storage: memoryStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

export const uploadChatImage = multer({
  storage: memoryStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});
