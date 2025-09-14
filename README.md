# � StreamSync

A synchronized video viewing application built with Node.js, Express, and Socket.IO.

## Features

- 🎥 Synchronized video playback across multiple users
- 💬 Real-time chat functionality
- 📋 Video queue management
- 👥 Participant tracking
- 📱 Mobile-responsive design
- 🌙 Modern dark theme with glass morphism

## Technologies Used

- **Backend**: Node.js, Express.js, Socket.IO
- **Frontend**: HTML5, CSS3, JavaScript, Tailwind CSS
- **Video Player**: YouTube iframe API
- **Real-time Communication**: WebSockets

## Local Development

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. Open http://localhost:3000 in your browser

## Deployment

### Quick Deploy to Render (Recommended - Free)

1. **Run deployment script:**
   ```bash
   # Windows
   deploy-render.bat
   
   # Mac/Linux  
   ./deploy-render.sh
   ```

2. **Push to GitHub:**
   ```bash
   git remote add origin <your-github-repo-url>
   git push -u origin main
   ```

3. **Deploy on Render:**
   - Go to [render.com](https://render.com)
   - Sign up/login with GitHub
   - Click "New Web Service"
   - Connect your GitHub repository
   - Configure:
     - **Environment**: Node
     - **Build Command**: `npm install`
     - **Start Command**: `npm start`
     - **Plan**: Free
   - Click "Create Web Service"

### Alternative Platforms

This application also works on:
- Heroku (save your credits for bigger projects!)
- Railway
- Vercel
- DigitalOcean App Platform

## Environment Variables

- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment mode (development/production)

## License

MIT License
