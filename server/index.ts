import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { pool } from "./db";
import bcrypt from "bcrypt";

// Auto-create admin user on startup if not exists
async function initializeAdmin() {
  try {
    const client = await pool.connect();
    try {
      const checkResult = await client.query('SELECT id FROM users WHERE username = $1', ['admin']);
      
      if (checkResult.rowCount === 0) {
        // Hash password 'admin123'
        const hashedPassword = await bcrypt.hash('admin123', 10);
        
        await client.query(
          'INSERT INTO users (username, password, email, mobile, role, balance) VALUES ($1, $2, $3, $4, $5, $6)',
          ['admin', hashedPassword, 'admin@kinggames.com', '9999999999', 'admin', 0]
        );
        
        log('✅ Admin user created successfully (username: admin, password: admin123)');
      } else {
        log('ℹ️  Admin user already exists');
      }
    } finally {
      client.release();
    }
  } catch (error) {
    log('⚠️  Could not initialize admin user:', error);
  }
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Route to serve the login test page
app.get('/login-test', (req, res) => {
  res.sendFile('login-test.html', { root: process.cwd() });
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Initialize admin user on startup
  await initializeAdmin();
  
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = 5000;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
