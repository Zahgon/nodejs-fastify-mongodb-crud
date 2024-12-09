FROM node:20.11-alpine3.18 as build

WORKDIR /src/

# COPY package.json package-lock.json /src/

COPY . /src/

RUN  npm ci --silent
# FROM node:20.11-alpine3.18 as dev

# WORKDIR /src/

# COPY --from=build /src/node_modules node_modules

USER node

CMD npm run start
