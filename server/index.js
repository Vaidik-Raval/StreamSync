const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const rooms = {};
const roomStates = {}; // Track video state per room
const roomQueues = {}; // Track video queues per room

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('/create-room', (req, res) => {
  const roomId = uuidv4().slice(0, 6);
  res.redirect(`/room/${roomId}?host=true`);
});

app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'room.html'));
});

io.on('connection', (socket) => {
  let roomId = null;
  let username = null;
  let isHost = false;

  socket.on('join-room', ({ roomId: rid, username: uname, isHost: host }) => {
    roomId = rid;
    username = uname;
    isHost = host;

    socket.join(roomId);
    socket.username = username;
    socket.isHost = isHost;

    // Initialize room data structures if they don't exist
    if (!rooms[roomId]) rooms[roomId] = [];
    if (!roomStates[roomId]) roomStates[roomId] = {};
    if (!roomQueues[roomId]) roomQueues[roomId] = { queue: [], currentIndex: -1 };

    rooms[roomId].push(username);

    // Send current participants to all
    io.to(roomId).emit('update-participants', rooms[roomId]);

    // Send current queue state to the new user
    socket.emit('queue-update', {
      queue: roomQueues[roomId].queue,
      currentIndex: roomQueues[roomId].currentIndex,
      currentVideo: roomQueues[roomId].currentIndex >= 0 ? 
        roomQueues[roomId].queue[roomQueues[roomId].currentIndex] : null
    });

    // Notify others
    socket.to(roomId).emit('chat-message', {
      username: 'System',
      message: `${username} joined the watch party.`
    });

    // Send current video state to late joiners
    if (roomStates[roomId] && roomStates[roomId].videoId) {
      setTimeout(() => {
        socket.emit('sync-video', {
          type: 'load',
          videoId: roomStates[roomId].videoId,
          title: roomStates[roomId].title || 'Loading...'
        });
        
        setTimeout(() => {
          socket.emit('sync-video', {
            type: roomStates[roomId].isPlaying ? 'play' : 'pause',
            currentTime: roomStates[roomId].currentTime || 0
          });
        }, 1000);
      }, 1000);
    }
  });

  socket.on('queue-action', (data) => {
    if (!roomId || !socket.isHost) return;
    
    const roomQueue = roomQueues[roomId];
    
    switch (data.type) {
      case 'add':
        // Add video to queue
        roomQueue.queue.push({
          videoId: data.videoId,
          title: data.title || `Video ${roomQueue.queue.length + 1}`,
          addedBy: username
        });
        
        // If no video is currently playing, start the first one
        if (roomQueue.currentIndex === -1 && roomQueue.queue.length === 1) {
          roomQueue.currentIndex = 0;
          playVideoFromQueue(roomId, 0);
        }
        break;
        
      case 'skip':
      case 'next':
        // Play next video in queue
        if (roomQueue.currentIndex < roomQueue.queue.length - 1) {
          roomQueue.currentIndex++;
          playVideoFromQueue(roomId, roomQueue.currentIndex);
        } else {
          // No more videos in queue
          roomQueue.currentIndex = -1;
          roomStates[roomId] = {};
          io.to(roomId).emit('sync-video', { type: 'load', videoId: '', title: 'Queue finished' });
        }
        break;
        
      case 'play':
        // Play specific video from queue
        if (data.index >= 0 && data.index < roomQueue.queue.length) {
          roomQueue.currentIndex = data.index;
          playVideoFromQueue(roomId, data.index);
        }
        break;
        
      case 'remove':
        // Remove video from queue
        if (data.index >= 0 && data.index < roomQueue.queue.length) {
          // If removing currently playing video, skip to next
          if (data.index === roomQueue.currentIndex) {
            roomQueue.queue.splice(data.index, 1);
            if (roomQueue.currentIndex >= roomQueue.queue.length) {
              roomQueue.currentIndex = roomQueue.queue.length > 0 ? roomQueue.queue.length - 1 : -1;
            }
            if (roomQueue.currentIndex >= 0) {
              playVideoFromQueue(roomId, roomQueue.currentIndex);
            } else {
              roomStates[roomId] = {};
              io.to(roomId).emit('sync-video', { type: 'load', videoId: '', title: 'Queue empty' });
            }
          } else {
            // Just remove the video and adjust current index if needed
            roomQueue.queue.splice(data.index, 1);
            if (data.index < roomQueue.currentIndex) {
              roomQueue.currentIndex--;
            }
          }
        }
        break;
    }
    
    // Send updated queue to all users
    io.to(roomId).emit('queue-update', {
      queue: roomQueue.queue,
      currentIndex: roomQueue.currentIndex,
      currentVideo: roomQueue.currentIndex >= 0 ? roomQueue.queue[roomQueue.currentIndex] : null
    });
    
    // Send system message about queue changes
    let message = '';
    switch (data.type) {
      case 'add':
        message = `${username} added "${data.title}" to the queue.`;
        break;
      case 'skip':
        message = `${username} skipped to the next video.`;
        break;
      case 'remove':
        message = `${username} removed a video from the queue.`;
        break;
    }
    
    if (message) {
      io.to(roomId).emit('chat-message', {
        username: 'System',
        message: message
      });
    }
  });

  function playVideoFromQueue(roomId, index) {
    const roomQueue = roomQueues[roomId];
    if (index >= 0 && index < roomQueue.queue.length) {
      const video = roomQueue.queue[index];
      
      // Update room state
      roomStates[roomId] = {
        videoId: video.videoId,
        title: video.title,
        currentTime: 0,
        isPlaying: true
      };
      
      // Send load command to all clients
      io.to(roomId).emit('sync-video', {
        type: 'load',
        videoId: video.videoId,
        title: video.title
      });
    }
  }

  socket.on('video-action', (data) => {
    if (!roomId || !socket.isHost) return;
    
    if (!roomStates[roomId]) roomStates[roomId] = {};

    if (data.type === 'play') {
      roomStates[roomId].isPlaying = true;
      roomStates[roomId].currentTime = data.currentTime;
    } else if (data.type === 'pause') {
      roomStates[roomId].isPlaying = false;
      roomStates[roomId].currentTime = data.currentTime;
    } else if (data.type === 'seek') {
      roomStates[roomId].currentTime = data.currentTime;
    }

    socket.to(roomId).emit('sync-video', data);
  });

  socket.on('chat-message', (data) => {
    if (roomId) {
      io.to(roomId).emit('chat-message', data);
    }
  });

  socket.on('player-ready', (rid) => {
    socket.emit('player-ready-ack', {});
  });

  socket.on('disconnect', () => {
    if (roomId && rooms[roomId]) {
      rooms[roomId] = rooms[roomId].filter(name => name !== username);
      io.to(roomId).emit('update-participants', rooms[roomId]);
      
      socket.to(roomId).emit('chat-message', {
        username: 'System',
        message: `${username} left the watch party.`
      });
      
      // Clean up empty rooms
      if (rooms[roomId].length === 0) {
        delete rooms[roomId];
        delete roomStates[roomId];
        delete roomQueues[roomId];
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`� StreamSync Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});