import http from "node:http";
import app from "./app";
import { config } from "./config";
import { attachProgressServer } from "./services/progress";

const port = config.port;
const server = http.createServer(app);

attachProgressServer(server);

server.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
