# Backend PeopleFinder Moviles

Backend Node.js para una app social con:

- Registro e inicio de sesion con imagen de perfil.
- Gestion de amistades con logica de swipe (izquierda/derecha).
- Chat en tiempo real con Socket.IO.
- Persistencia de chats y mensajes en MongoDB.
- Imagenes almacenadas en MongoDB GridFS (sin carpeta local uploads).

## Stack

- Node.js + Express
- MongoDB + Mongoose
- express-session + connect-mongo
- Socket.IO
- Multer (en memoria) + GridFS

## Estructura

- backend
- backend/controllers
- backend/routes
- backend/models
- backend/middleware
- backend/services

## Variables de entorno

Archivo: backend/.env

Ejemplo:

```env
PORT=5000
MONGODB_URI=mongodb+srv://usuario:password@cluster.mongodb.net/peoplefinder
SESSION_SECRET=tu_secreto_de_sesion
```

## Instalacion y ejecucion

1. Ir a la carpeta backend.
2. Instalar dependencias con npm install.
3. Configurar backend/.env.
4. Ejecutar npm start.

Servidor por defecto: http://localhost:5000

## Autenticacion y sesiones

- Este backend usa sesiones (cookie connect.sid).
- Para pruebas en Postman/Insomnia o frontend, se debe enviar credenciales/cookies en cada request autenticado.

## API HTTP

### Auth

- POST /auth/register
	- multipart/form-data
	- campos: username, email, password, fullName, bio(opcional), profileImage(opcional)
- POST /auth/login
	- body JSON: usernameOrEmail, password
- POST /auth/logout
- GET /auth/check
- GET /auth/profile
- PUT /auth/profile
	- multipart/form-data
	- campos editables: username, email, password, fullName, bio, profileImage
- DELETE /auth/profile/image
- DELETE /auth/profile

### Friends

- GET /friends/discover
	- usuarios sugeridos (sin amigos ni solicitudes pendientes)
- POST /friends/swipe
	- body JSON: targetUserId, direction
	- direction: left (rechaza) o right (solicita o acepta)
- GET /friends/requests
	- solicitudes pendientes recibidas
- GET /friends
	- lista de amistades
- DELETE /friends/:friendId

### Chats

- GET /chats
	- lista de chats del usuario autenticado
- POST /chats
	- body JSON: friendId
	- crea o devuelve chat existente con ese amigo
- GET /chats/:id
	- retorna chat + mensajes
- GET /chats/:id/messages?page=1&limit=30
	- historial paginado
- POST /chats/:id/messages
	- multipart/form-data o body con texto
	- campos: text(opcional), image(opcional), imageUrl(opcional)
	- requiere al menos text o image/imageUrl
- POST /chats/:id/read
	- marca mensajes como leidos
- GET /chats/unread-summary
	- resumen de no leidos
- DELETE /chats/:id

### Media (GridFS)

- GET /media/:fileId
	- sirve imagen almacenada en MongoDB GridFS.
	- profileImage e imageUrl se guardan con formato /media/<fileId>.

## Socket.IO (chat en vivo)

El socket usa la misma sesion del login HTTP.

Eventos cliente -> servidor:

- join_chat
	- payload: { chatId }
- send_message
	- payload: { chatId, text, imageUrl }

Eventos servidor -> cliente:

- new_message
	- payload: { chatId, message }
- chat_updated
	- payload: { chatId, lastMessage, lastMessageAt }
- chat_error
	- payload: { message }

## Flujo sugerido de uso

1. Registrar usuario A y usuario B.
2. Login con A y B en sesiones separadas.
3. Hacer swipe right entre ambos para generar amistad.
4. Crear chat con POST /chats usando friendId.
5. Unirse al chat con join_chat por socket.
6. Enviar mensajes en vivo con send_message o por HTTP.
7. Enviar imagen por chat con POST /chats/:id/messages usando multipart image.

## Notas

- Las imagenes ya no se guardan en disco local.
- El almacenamiento de imagenes usa GridFS en MongoDB (colecciones mediaFiles.files y mediaFiles.chunks).

