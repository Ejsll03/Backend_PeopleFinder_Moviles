import express from "express";
import {
  getDiscoverUsers,
  swipeFriend,
  getFriendRequests,
  getFriendRequestActivity,
  cancelSentFriendRequest,
  acceptRejectedRequest,
  getFriends,
  getFriendDetail,
  removeFriend,
} from "../controllers/friendController.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAuth);

router.get("/discover", getDiscoverUsers);
router.post("/swipe", swipeFriend);
router.get("/requests", getFriendRequests);
router.get("/requests/activity", getFriendRequestActivity);
router.delete("/requests/sent/:requestId", cancelSentFriendRequest);
router.post("/requests/rejected/:requestId/accept", acceptRejectedRequest);
router.get("/", getFriends);
router.get("/:friendId", getFriendDetail);
router.delete("/:friendId", removeFriend);

export default router;
