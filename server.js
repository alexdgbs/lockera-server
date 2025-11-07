require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sgMail = require('@sendgrid/mail');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://www.lockera.online',
    'https://lockera.online'
  ],
  credentials: true
}));
app.use(bodyParser.json());
const dbFile = path.join(__dirname, 'db.json');
const adapter = new JSONFile(dbFile);
const db = new Low(adapter, { users: [], serials: [] });

async function initDB() {
  await db.read();
  db.data ||= { users: [], serials: [] };
  await db.write();
}
initDB();
function generateToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No autorizado' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Token inválido' });
    req.user = user;
    next();
  });
}
app.post('/api/register', async (req, res) => {
  await db.read();
  const { name, email, password, serial } = req.body;

  if (!name || !email || !password || !serial)
    return res.status(400).json({ message: 'Faltan datos' });

  const userExists = db.data.users.find(u => u.email === email);
  if (userExists)
    return res.status(400).json({ message: 'Correo ya registrado' });

  const serialEntry = db.data.serials.find(s => s.serial === String(serial) && s.used === false);
  if (!serialEntry)
    return res.status(400).json({ message: 'Serial inválido o ya usado' });

  const hashed = await bcrypt.hash(password, 10);
  const newUser = { id: Date.now(), name, email, password: hashed, serial };
  db.data.users.push(newUser);

  serialEntry.used = true;
  await db.write();

  res.json({ message: 'Usuario registrado correctamente' });
});

app.post('/api/login', async (req, res) => {
  await db.read();
  const { email, password } = req.body;

  const user = db.data.users.find(u => u.email === email);
  if (!user) return res.status(400).json({ message: 'Usuario no encontrado' });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ message: 'Contraseña incorrecta' });

  const token = generateToken(user);
  res.json({ message: 'Login exitoso', token });
});
app.get('/api/me', authenticateToken, async (req, res) => {
  await db.read();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(401).json({ message: 'No autorizado' });

  const { password, ...userData } = user;
  res.json(userData);
});

app.post('/api/logout', (req, res) => {
  res.json({ message: 'Sesión cerrada' });
});
app.post('/api/users', authenticateToken, async (req, res) => {
  await db.read();
  const { firstName, lastName } = req.body;
  const creator = db.data.users.find(u => u.id === req.user.id);
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

  db.data.users.push(newUser);
  await db.write();
  const msg = {
    to: 'securebylockera@gmail.com',
    from: 'securebylockera@gmail.com',
    subject: `Subusuario agregado por ${creator.name}`,
    html: `
      <h3>Nuevo subusuario agregado</h3>
      <p>Usuario principal: <b>${creator.name}</b></p>
      <p>Subusuario agregado: <b>${newUser.name}</b></p>
      <p>Fecha: ${new Date().toLocaleString()}</p>
    `
  };
  sgMail.send(msg).catch(err => console.error(err));

  res.json({ message: 'Subusuario agregado correctamente', user: newUser });
});
app.get('/api/users', authenticateToken, async (req, res) => {
  await db.read();
  const subUsers = db.data.users.filter(u => u.createdBy === req.user.id);
  const sanitized = subUsers.map(({ password, ...data }) => data);
  res.json(sanitized);
});
app.get('/api/subusers/:id', authenticateToken, async (req, res) => {
  await db.read();
  const subUser = db.data.users.find(u => u.id === Number(req.params.id));
  if (!subUser) return res.status(404).json({ message: 'Subusuario no encontrado' });

  const { password, ...userData } = subUser;
  res.json(userData);
});
app.delete('/api/users/:id', authenticateToken, async (req, res) => {
  await db.read();
  const creator = db.data.users.find(u => u.id === req.user.id);
  if (!creator) return res.status(401).json({ message: 'No autorizado' });

  const subUserId = Number(req.params.id);
  const subUserIndex = db.data.users.findIndex(u => u.id === subUserId);
  if (subUserIndex === -1) return res.status(404).json({ message: 'Subusuario no encontrado' });

  const removedUser = db.data.users.splice(subUserIndex, 1)[0];
  await db.write();
  const msg = {
    to: 'securebylockera@gmail.com',
    from: 'securebylockera@gmail.com',
    subject: `Subusuario eliminado por ${creator.name}`,
    html: `
      <h3>Subusuario eliminado</h3>
      <p>Usuario principal: <b>${creator.name}</b></p>
      <p>Subusuario eliminado: <b>${removedUser.name}</b></p>
      <p>Fecha: ${new Date().toLocaleString()}</p>
    `
  };
  sgMail.send(msg).catch(err => console.error(err));

  res.json({ message: 'Subusuario eliminado correctamente', user: removedUser });
});
app.post('/api/generate-serial', authenticateToken, async (req, res) => {
  await db.read();
  const { serial } = req.body;
  if (!serial) return res.status(400).json({ message: 'Falta serial' });

  if (db.data.serials.find(s => s.serial === serial))
    return res.status(400).json({ message: 'Serial ya existe' });

  db.data.serials.push({ serial, used: false });
  await db.write();
  res.json({ message: 'Serial agregado correctamente', serial });
});

app.post('/api/validate-serial', async (req, res) => {
  await db.read();
  const { serial } = req.body;
  if (!serial) return res.status(400).json({ message: 'Falta serial' });

  const serialEntry = db.data.serials.find(s => s.serial === String(serial));
  if (!serialEntry) return res.status(400).json({ message: 'Serial inválido' });
  if (serialEntry.used) return res.status(400).json({ message: 'Serial ya usado' });

  res.json({ message: 'Serial válido' });
});
app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
