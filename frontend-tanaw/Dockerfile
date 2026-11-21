# Local development image for docker-compose.yml. Vercel builds the deployed
# portal from vercel.json, not from this file.
FROM node:24-alpine

WORKDIR /app

# Skip npm's audit and funding checks in this image. They run on every
# `npm ci` and on the `npm install` that docker-compose.yml runs at each start,
# and the audit can take minutes once an advisory matches a dependency. Run
# `npm audit` deliberately instead.
ENV NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
