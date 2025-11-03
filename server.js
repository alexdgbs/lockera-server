require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const sgMail = require('@sendgrid/mail');

const app = express();
const PORT = process.env.PORT || 3000;

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

app.use(cors({
   origin: 'https://lockera.vercel.app',
   credentials: true
}));

app.use(bodyParser.json());
app.use(cookieParser());

const USERS_FILE = './users.json';
let users = [];
if (fs.existsSync(USERS_FILE)) users = JSON.parse(fs.readFileSync(USERS_FILE));

function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

const SERIALS_FILE = './serials.json';
let serials = [];
if (fs.existsSync(SERIALS_FILE)) serials = JSON.parse(fs.readFileSync(SERIALS_FILE));

function saveSerials() {
  fs.writeFileSync(SERIALS_FILE, JSON.stringify(serials, null, 2));
}

const isProd = process.env.NODE_ENV === 'production';

app.post('/api/register', async (req, res) => {
  const { name, email, password, serial } = req.body;
  if (!name || !email || !password || !serial) return res.status(400).json({ message: 'Faltan datos' });
  if (users.find(u => u.email === email)) return res.status(400).json({ message: 'Correo ya registrado' });
  const serialEntry = serials.find(s => s.serial === String(serial) && s.used === false);
  if (!serialEntry) return res.status(400).json({ message: 'Serial inválido o ya usado' });
  const hashed = await bcrypt.hash(password, 10);
  const newUser = { id: Date.now(), name, email, password: hashed, serial };
  users.push(newUser);
  saveUsers();
  serialEntry.used = true;
  saveSerials();
  res.json({ message: 'Usuario registrado correctamente' });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);
  if (!user) return res.status(400).json({ message: 'Usuario no encontrado' });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ message: 'Contraseña incorrecta' });
  res.cookie('user', user.id, {
    httpOnly: true,
    sameSite: isProd ? 'None' : 'Lax',
    secure: isProd,
    path: '/',
    maxAge: 24 * 60 * 60 * 1000
  });
  res.json({ message: 'Login exitoso' });
});

app.get('/api/me', (req, res) => {
  const userId = req.cookies.user;
  if (!userId) return res.status(401).json({ message: 'No autorizado' });
  const user = users.find(u => u.id == userId);
  if (!user) return res.status(401).json({ message: 'No autorizado' });
  const { password, ...userData } = user;
  res.json(userData);
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('user', {
    httpOnly: true,
    sameSite: isProd ? 'None' : 'Lax',
    secure: isProd,
    path: '/'
  });
  res.json({ message: 'Sesión cerrada' });
});

app.post('/api/users', (req, res) => {
  const { firstName, lastName } = req.body;
  const creatorId = req.cookies.user;
  if (!creatorId) return res.status(401).json({ message: 'No autorizado' });
  const creator = users.find(u => u.id == creatorId);
  if (!creator) return res.status(401).json({ message: 'No autorizado' });
  const newUser = {
    id: Date.now(),
    name: `${firstName} ${lastName}`,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@lockera.com`,
    password: null,
    serial: creator.serial,
    createdBy: creator.id,
    createdAt: new Date().toISOString()
  };
  users.push(newUser);
  saveUsers();
  const msg = {
    to: 'securebylockera@gmail.com',
    from: 'securebylockera@gmail.com',
    subject: `Subusuario agregado por ${creator.name}`,
    html: `<h3>Nuevo subusuario agregado</h3>
           <p>Usuario principal: <b>${creator.name}</b> (${creator.email})</p>
           <p>Subusuario agregado: <b>${newUser.name}</b> (${newUser.email})</p>
           <p>Fecha: ${new Date().toLocaleString()}</p>`
  };
  sgMail.send(msg).catch(err => console.error(err));
  res.json({ message: 'Subusuario agregado correctamente', user: newUser });
});

app.get('/api/users', (req, res) => {
  const creatorId = Number(req.cookies.user);
  if (!creatorId) return res.status(401).json({ message: 'No autorizado' });
  const subUsers = users.filter(u => u.createdBy === creatorId);
  const sanitized = subUsers.map(u => {
    const { password, ...data } = u;
    return data;
  });
  res.json(sanitized);
});

app.get('/api/subusers/:id', (req, res) => {
  const subUserId = Number(req.params.id);
  const subUser = users.find(u => u.id === subUserId);
  if (!subUser) return res.status(404).json({ message: 'Subusuario no encontrado' });
  const { password, ...userData } = subUser;
  res.json(userData);
});

app.delete('/api/users/:id', (req, res) => {
  const userId = req.cookies.user;
  if (!userId) return res.status(401).json({ message: 'No autorizado' });
  const creator = users.find(u => u.id == userId);
  if (!creator) return res.status(401).json({ message: 'No autorizado' });
  const subUserId = Number(req.params.id);
  const subUserIndex = users.findIndex(u => u.id === subUserId);
  if (subUserIndex === -1) return res.status(404).json({ message: 'Subusuario no encontrado' });
  const removedUser = users.splice(subUserIndex, 1)[0];
  saveUsers();
  const msg = {
    to: 'securebylockera@gmail.com',
    from: 'securebylockera@gmail.com',
    subject: `Subusuario eliminado por ${creator.name}`,
    html: `<h3>Subusuario eliminado</h3>
           <p>Usuario principal: <b>${creator.name}</b> (${creator.email})</p>
           <p>Subusuario eliminado: <b>${removedUser.name}</b> (${removedUser.email})</p>
           <p>Fecha: ${new Date().toLocaleString()}</p>`
  };
  sgMail.send(msg).catch(err => console.error(err));
  res.json({ message: 'Subusuario eliminado correctamente', user: removedUser });
});

app.post('/api/generate-serial', (req, res) => {
  const { serial } = req.body;
  if (!serial) return res.status(400).json({ message: 'Falta serial' });
  if (serials.find(s => s.serial === serial)) return res.status(400).json({ message: 'Serial ya existe' });
  serials.push({ serial, used: false });
  saveSerials();
  res.json({ message: 'Serial agregado correctamente', serial });
});

app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));