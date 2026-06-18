# Imagen para desplegar Tv Player (backend Node + frontend estatico) en Koyeb.
FROM node:18-alpine

WORKDIR /app

# Instalar solo dependencias de produccion
COPY package.json ./
RUN npm install --omit=dev

# Copiar el resto del codigo
COPY . .

ENV NODE_ENV=production
# Koyeb inyecta PORT; exponemos el por defecto de Koyeb.
EXPOSE 8000

CMD ["npm", "start"]
