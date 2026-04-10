import mongoose from "mongoose";

let mediaBucket;

export function initGridFS() {
  if (!mongoose.connection?.db) {
    throw new Error("Conexion de MongoDB no disponible para inicializar GridFS");
  }

  mediaBucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: "mediaFiles",
  });
}

function getBucket() {
  if (!mediaBucket) {
    throw new Error("GridFS no inicializado");
  }
  return mediaBucket;
}

export function extractMediaId(mediaUrl = "") {
  const match = mediaUrl.match(/\/media\/([a-fA-F0-9]{24})/);
  return match ? match[1] : null;
}

export function uploadBufferToGridFS(file, folder = "general") {
  if (!file?.buffer) {
    return Promise.resolve("");
  }

  const bucket = getBucket();
  const safeName = (file.originalname || "file").replace(/\s+/g, "-");
  const fileName = `${folder}-${Date.now()}-${safeName}`;

  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(fileName, {
      contentType: file.mimetype,
      metadata: {
        folder,
        originalName: file.originalname || "file",
      },
    });

    const uploadedFileId = uploadStream.id;

    uploadStream.on("error", reject);
    uploadStream.on("finish", () => {
      if (!uploadedFileId) {
        reject(new Error("No se pudo obtener el ID del archivo en GridFS"));
        return;
      }

      resolve(`/media/${uploadedFileId.toString()}`);
    });

    uploadStream.end(file.buffer);
  });
}

export async function deleteGridFSFileByUrl(mediaUrl = "") {
  const mediaId = extractMediaId(mediaUrl);
  if (!mediaId) return;

  const bucket = getBucket();

  try {
    await bucket.delete(new mongoose.Types.ObjectId(mediaId));
  } catch (error) {
    if (error?.message?.includes("FileNotFound")) {
      return;
    }
    throw error;
  }
}

export async function streamGridFSFile(mediaId, res) {
  if (!mongoose.Types.ObjectId.isValid(mediaId)) {
    return false;
  }

  const bucket = getBucket();
  const fileId = new mongoose.Types.ObjectId(mediaId);
  const files = await bucket.find({ _id: fileId }).toArray();

  if (!files.length) {
    return false;
  }

  const file = files[0];
  if (file.contentType) {
    res.setHeader("Content-Type", file.contentType);
  }

  return new Promise((resolve, reject) => {
    const downloadStream = bucket.openDownloadStream(fileId);

    downloadStream.on("error", reject);
    downloadStream.on("end", () => resolve(true));
    downloadStream.pipe(res);
  });
}
