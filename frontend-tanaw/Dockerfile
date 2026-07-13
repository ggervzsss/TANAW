FROM node:24-alpine AS base

WORKDIR /app

COPY package*.json ./
RUN npm ci

FROM base AS development

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

FROM base AS build

ARG VITE_API_BASE_URL
ARG TANAW_PUBLIC_DEPLOYMENT=false
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV TANAW_PUBLIC_DEPLOYMENT=$TANAW_PUBLIC_DEPLOYMENT

COPY . .
RUN npm run build

FROM nginx:1.29-alpine AS production

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
