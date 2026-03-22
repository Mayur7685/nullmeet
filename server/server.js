import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

// Meeting rooms: meetingId -> { host, participants[], locked, maxParticipants }
const meetings = new Map();

io.on("connection", (socket) => {
  console.log(`[connect] ${socket.id}`);

  // Host creates a meeting
  socket.on("create_meeting", ({ meetingId, hostAddress, numDays, maxParticipants }) => {
    console.log(`[create] Meeting ${meetingId} by ${hostAddress} (${numDays} days, max ${maxParticipants})`);
    socket.join(meetingId);

    meetings.set(meetingId, {
      host: { socketId: socket.id, address: hostAddress },
      participants: [{ socketId: socket.id, address: hostAddress, ready: false }],
      locked: false,
      numDays: numDays || 1,
      maxParticipants: maxParticipants || 10,
    });

    socket.emit("meeting_created", { meetingId });
  });

  // Participant joins a meeting
  socket.on("join_meeting", ({ meetingId, participantAddress }) => {
    console.log(`[join] ${participantAddress} → Meeting ${meetingId}`);
    const meeting = meetings.get(meetingId);

    if (!meeting) {
      socket.emit("join_error", { message: "Meeting not found" });
      return;
    }
    if (meeting.locked) {
      socket.emit("join_error", { message: "Meeting is locked" });
      return;
    }
    if (meeting.participants.length >= meeting.maxParticipants) {
      socket.emit("join_error", { message: "Meeting is full" });
      return;
    }
    // Check not already joined
    if (meeting.participants.some((p) => p.address === participantAddress)) {
      socket.emit("join_error", { message: "Already joined" });
      return;
    }

    socket.join(meetingId);
    meeting.participants.push({
      socketId: socket.id,
      address: participantAddress,
      ready: false,
    });

    // Broadcast to everyone in room (including sender)
    io.to(meetingId).emit("participant_joined", {
      participantAddress,
      participants: meeting.participants.map((p) => ({
        address: p.address,
        ready: p.ready,
      })),
      count: meeting.participants.length,
      max: meeting.maxParticipants,
    });
  });

  // Host locks meeting — no more joins
  socket.on("lock_meeting", ({ meetingId }) => {
    const meeting = meetings.get(meetingId);
    if (!meeting) return;
    if (meeting.host.socketId !== socket.id) return;

    meeting.locked = true;
    console.log(
      `[lock] Meeting ${meetingId} locked with ${meeting.participants.length} participants`
    );

    io.to(meetingId).emit("meeting_locked", {
      participants: meeting.participants.map((p) => ({
        address: p.address,
        ready: p.ready,
      })),
    });
  });

  // Participant signals they have submitted slots to TEE
  socket.on("participant_ready", ({ meetingId }) => {
    const meeting = meetings.get(meetingId);
    if (!meeting) return;

    const participant = meeting.participants.find(
      (p) => p.socketId === socket.id
    );
    if (participant) {
      participant.ready = true;
    }

    const readyCount = meeting.participants.filter((p) => p.ready).length;
    const allReady = readyCount === meeting.participants.length;

    console.log(
      `[ready] ${readyCount}/${meeting.participants.length} ready in Meeting ${meetingId}`
    );

    io.to(meetingId).emit("participant_ready", {
      address: participant?.address,
      participants: meeting.participants.map((p) => ({
        address: p.address,
        ready: p.ready,
      })),
      readyCount,
      allReady,
    });

    if (allReady) {
      io.to(meetingId).emit("all_submitted");
    }
  });

  // Host broadcasts computed result to all parties
  socket.on("broadcast_result", ({ meetingId, day, slot, score, valid }) => {
    console.log(
      `[result] Meeting ${meetingId}: day=${day}, slot=${slot}, score=${score}, valid=${valid}`
    );
    io.to(meetingId).emit("meeting_result", { day, slot, score, valid });
  });

  // Cleanup on disconnect
  socket.on("disconnect", () => {
    console.log(`[disconnect] ${socket.id}`);
    for (const [meetingId, meeting] of meetings) {
      const idx = meeting.participants.findIndex(
        (p) => p.socketId === socket.id
      );
      if (idx !== -1) {
        const address = meeting.participants[idx].address;
        console.log(`[disconnect] ${address} left Meeting ${meetingId}`);

        // Notify remaining participants
        io.to(meetingId).emit("participant_disconnected", {
          address,
          participants: meeting.participants
            .filter((p) => p.socketId !== socket.id)
            .map((p) => ({ address: p.address, ready: p.ready })),
        });
      }
    }
  });
});

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    meetings: meetings.size,
    version: "2.0.0",
  });
});

const PORT = process.env.PORT || 3030;
httpServer.listen(PORT, () => {
  console.log(`Nullmeet v2 coordination server running on port ${PORT}`);
});
