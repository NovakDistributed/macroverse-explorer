# Macroverse Explorer

This is the next-generation Macroverse Explorer, for browsing stars and planetary systems.

To run it, `npm install` (which itself involves a git clone and can take a while), and then open two terminals.

Run `truffle develop` in one, and `migrate --reset` inside that. This will start up a test Ethereum node at `http://localhost:9545`.

Run `npm run dev` in the other terminal, to run `budo`, which will serve the frontend on `http://localhost:9966`.
