const mongoose = require('mongoose');

const MatchHistorySchema = new mongoose.Schema({
  playerId: {
    type: String,
    required: true
  },
  playerName: {
    type: String,
    required: true,
    index: true
  },
  agent: {
    type: String,
    required: true
  },
  team: {
    type: String,
    enum: ['attackers', 'defenders'],
    required: true
  },
  isVictory: {
    type: Boolean,
    required: true
  },
  kills: {
    type: Number,
    default: 0
  },
  deaths: {
    type: Number,
    default: 0
  },
  assists: {
    type: Number,
    default: 0
  },
  score: {
    type: Number,
    default: 0
  },
  finalScore: {
    attackers: Number,
    defenders: Number
  },
  roundNumber: {
    type: Number,
    required: true
  },
  matchDate: {
    type: Date,
    default: Date.now,
    index: true
  },
  roomCode: {
    type: String
  }
}, {
  timestamps: true
});

// Compound index for efficient queries by playerName and date
MatchHistorySchema.index({ playerName: 1, matchDate: -1 });

module.exports = mongoose.model('MatchHistory', MatchHistorySchema);
