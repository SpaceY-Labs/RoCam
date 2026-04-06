/**
 * Author: Jianqing Liu
 * Date: 2026-01-27
 * Purpose: Entry point that starts the Express server on the configured port.
 */
import app from "./app";
import { config } from "./config";

const port = config.port;

app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
