import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    fullName: { type: String, required: true, trim: true },
    city: { type: String, default: "", trim: true },
    bio: { type: String, default: "", trim: true },
    interests: [{ type: String, trim: true }],
    emailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String, default: "" },
    emailVerificationExpires: { type: Date },
    privacySettings: {
      profileVisibility: {
        type: String,
        enum: ["public", "friends", "private"],
        default: "public",
      },
      friendRequestPermission: {
        type: String,
        enum: ["everyone", "friends_of_friends", "nobody"],
        default: "everyone",
      },
      messagePermission: {
        type: String,
        enum: ["everyone", "friends"],
        default: "friends",
      },
      showCity: { type: Boolean, default: true },
      showOnlineStatus: { type: Boolean, default: true },
      showReadReceipts: { type: Boolean, default: true },
      showLastSeen: { type: Boolean, default: true },
    },
    profileImage: { type: String, default: "" },
    friends: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);
