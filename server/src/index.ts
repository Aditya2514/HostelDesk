import { app } from "./app";
import { env } from "./config/env";
import { clock } from "./lib/clock";

async function bootstrap() {
  await clock.init();

  const server = app.listen(env.PORT, () => {
    console.log(`🚀 HostelDesk server running on port ${env.PORT} [${env.NODE_ENV}]`);
  });

  process.on("SIGTERM", () => {
    console.log("SIGTERM received, shutting down gracefully...");
    server.close(() => {
      console.log("Server closed.");
      process.exit(0);
    });
  });
}

bootstrap().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
