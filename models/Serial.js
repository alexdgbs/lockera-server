const mongoose = require('mongoose');

const serialSchema = new mongoose.Schema({
  serial: { type: String, required: true, unique: true },
  used: { type: Boolean, default: false }
});

module.exports = mongoose.model('Serial', serialSchema);
