require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sgMail = require('@sendgrid/mail');
const mongoose = require('mongoose');
const User = require('./models/User');
const Serial = require('./models/Serial');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB conectado'))
  .catch(err => console.error(err));

app.use(cors({
  origin: ['http://localhost:5173', 'https://www.lockera.online', 'https://lockera.online'],
  credentials: true
}));
app.use(bodyParser.json());

function generateToken(user) {
  return jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
}

function authenticateToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No autorizado' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Token inválido' });
    req.user = user;
    next();
  });
}

app.post('/api/validate-serial', async (req, res) => {
  const { serial } = req.body;
  if (!serial) return res.status(400).json({ message: 'Falta el serial' });
  const serialDoc = await Serial.findOne({ serial, used: false });
  if (!serialDoc) return res.status(400).json({ message: 'Serial inválido o ya usado' });
  res.json({ message: 'Serial válido' });
});

app.post('/api/register', async (req, res) => {
  const { name, email, password, serial } = req.body;
  if (!name || !email || !password || !serial)
    return res.status(400).json({ message: 'Faltan datos' });

  const exists = await User.findOne({ email });
  if (exists) return res.status(400).json({ message: 'Correo ya registrado' });

  const serialDoc = await Serial.findOne({ serial, used: false });
  if (!serialDoc) return res.status(400).json({ message: 'Serial inválido o ya usado' });

  const hashed = await bcrypt.hash(password, 10);
  const newUser = new User({ name, email, password: hashed, serial });
  await newUser.save();

  serialDoc.used = true;
  await serialDoc.save();

  res.json({ message: 'Usuario registrado correctamente' });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ message: 'Usuario no encontrado' });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ message: 'Contraseña incorrecta' });

  const token = generateToken(user);
  res.json({ message: 'Login exitoso', token });
});

app.get('/api/me', authenticateToken, async (req, res) => {
  const user = await User.findById(req.user.id).select('-password');
  if (!user) return res.status(401).json({ message: 'No autorizado' });
  res.json(user);
});

app.post('/api/users', authenticateToken, async (req, res) => {
  const { firstName, lastName } = req.body;
  const creator = await User.findById(req.user.id);
  if (!creator) return res.status(401).json({ message: 'No autorizado' });

  const newUser = new User({
    name: `${firstName} ${lastName}`,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@lockera.com`,
    serial: creator.serial,
    createdBy: creator._id
  });

  await newUser.save();

  const msg = {
    to: 'securebylockera@gmail.com',
    from: 'securebylockera@gmail.com',
    subject: `Subusuario agregado por ${creator.name}`,
    html: `<h3>Nuevo subusuario agregado</h3>
           <p>Usuario principal: <b>${creator.name}</b></p>
           <p>Subusuario agregado: <b>${newUser.name}</b></p>
           <p>Fecha: ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}</p>`
  };

  sgMail.send(msg).catch(console.error);
  res.json({ message: 'Subusuario agregado correctamente', user: newUser });
});

app.get('/api/users', authenticateToken, async (req, res) => {
  const subUsers = await User.find({ createdBy: req.user.id }).select('-password');
  res.json(subUsers);
});

app.delete('/api/users/:id', authenticateToken, async (req, res) => {
  const creator = await User.findById(req.user.id);
  if (!creator) return res.status(401).json({ message: 'No autorizado' });

  const subUser = await User.findByIdAndDelete(req.params.id);
  if (!subUser) return res.status(404).json({ message: 'Subusuario no encontrado' });

  const msg = {
    to: 'securebylockera@gmail.com',
    from: 'securebylockera@gmail.com',
    subject: `Subusuario eliminado por ${creator.name}`,
    html: `<h3>Subusuario eliminado</h3>
           <p>Usuario principal: <b>${creator.name}</b></p>
           <p>Subusuario eliminado: <b>${subUser.name}</b></p>
           <p>Fecha: ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}</p>`
  };

  sgMail.send(msg).catch(console.error);
  res.json({ message: 'Subusuario eliminado correctamente' });
});

app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
