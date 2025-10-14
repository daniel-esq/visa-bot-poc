# Open API


# Server 
## Setup
mkdir visa-bot-poc && cd visa-bot-poc

~~~
    npm init -y
    npm i openai express zod dotenv
    npm i -D typescript ts-node @types/node @types/express nodemon
    npx tsc --init
~~~

## Run
~~~
    cd server
    npm run dev
~~~

## Debug mode
~~~
    cd server
    npm i -D tsx cross-env
~~~


# Web 
## Setup
mkdir web && cd web

~~~
    npm create vite@latest . -- --template react-ts
    npm i
~~~

## Run
~~~
    cd web
    npm run dev
~~~

"dev:debug": "cross-env NODE_OPTIONS=\"--inspect=9229 --enable-source-maps\" tsx watch src/server.ts",