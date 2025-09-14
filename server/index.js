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

  socket.on('join-room', (data) => {
    roomId = data.roomId;
    username = data.username;
    socket.isHost = data.isHost; // Store host status
    
    socket.join(roomId);
    // console.log(`User ${username} joined room ${roomId}${socket.isHost ? ' as host' : ''}`);

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

    // Send current video state to late joiners - IMPROVED SYNC
    if (roomStates[roomId] && roomStates[roomId].videoId) {
      // console.log(`Syncing late joiner ${username} to current video:`, roomStates[roomId]);
      
      // First load the video
      socket.emit('sync-video', {
        type: 'load',
        videoId: roomStates[roomId].videoId,
        title: roomStates[roomId].title || 'Loading...'
      });
      
      // Then sync the playback state after a delay
      setTimeout(() => {
        if (roomStates[roomId].isPlaying) {
          socket.emit('sync-video', {
            type: 'play',
            currentTime: roomStates[roomId].currentTime || 0
          });
        } else {
          socket.emit('sync-video', {
            type: 'pause',
            currentTime: roomStates[roomId].currentTime || 0
          });
        }
      }, 2000); // Increased delay to ensure video loads
    }
  });  socket.on('queue-action', (data) => {
    // console.log(`Queue action by ${username} (host: ${socket.isHost}):`, data.type);
    
    if (!roomId || !socket.isHost) {
      // console.log(`Queue action rejected - not host or no room`);
      return;
    }
    
    const roomQueue = roomQueues[roomId];
    
    switch (data.type) {
      case 'add':
        // Add video to queue
        const newVideo = {
          videoId: data.videoId,
          title: data.title || `Video ${roomQueue.queue.length + 1}`,
          addedBy: username
        };
        roomQueue.queue.push(newVideo);
        
        // console.log(`Added video to queue:`, newVideo);
        
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
      
      // console.log(`Playing video from queue: ${video.title} (${video.videoId})`);
      
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
      
      // Auto-play after a short delay to ensure video is loaded
      setTimeout(() => {
        io.to(roomId).emit('sync-video', {
          type: 'play',
          currentTime: 0
        });
      }, 1500);
    }
  }

  socket.on('video-action', (data) => {
    // console.log(`Video action by ${username} (host: ${socket.isHost}):`, data.type);
    
    if (!roomId || !socket.isHost) {
      // console.log(`Video action rejected - not host or no room`);
      return;
    }
    
    if (!roomStates[roomId]) roomStates[roomId] = {};

    if (data.type === 'play') {
      roomStates[roomId].isPlaying = true;
      roomStates[roomId].currentTime = data.currentTime || 0;
      // console.log(`Video playing at time: ${roomStates[roomId].currentTime}`);
    } else if (data.type === 'pause') {
      roomStates[roomId].isPlaying = false;
      roomStates[roomId].currentTime = data.currentTime || 0;
      // console.log(`Video paused at time: ${roomStates[roomId].currentTime}`);
    } else if (data.type === 'seek') {
      roomStates[roomId].currentTime = data.currentTime || 0;
      // console.log(`Video seeked to time: ${roomStates[roomId].currentTime}`);
    }

    // Broadcast to all other clients (not the host who sent it)
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