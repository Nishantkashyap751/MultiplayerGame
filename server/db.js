const mongoose = require('mongoose');

// MongoDB Atlas connection string
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://nishanttkashyapp20:<db_password>@gamehistory.1mxvnvu.mongodb.net/?retryWrites=true&w=majority';

let isConnected = false;

async function connectToDatabase() {
  if (isConnected) {
    return;
  }

  // Gracefully handle placeholder password
  if (MONGODB_URI.includes('<db_password>')) {
    console.log('ℹ️ [MongoDB Atlas] MONGODB_URI contains placeholder "<db_password>". Set your MONGODB_URI environment variable on Render with your database password to enable persistent match career history.');
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    isConnected = true;
    console.log('✅ Connected to MongoDB Atlas');
  } catch (error) {
    console.warn('⚠️ MongoDB Atlas connection notice:', error.message);
  }
}

module.exports = { connectToDatabase, mongoose };
