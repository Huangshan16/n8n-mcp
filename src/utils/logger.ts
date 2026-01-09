import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

export interface LoggerConfig {
  level: LogLevel;
  prefix?: string;
  timestamp?: boolean;
}

export class Logger {
  private config: LoggerConfig;
  private static instance: Logger;
  private useFileLogging = false;
  private fileStream: fs.WriteStream | null = null;
  private filePath: string | null = null;
  // Cache environment variables for performance
  private readonly isStdio = process.env.MCP_MODE === 'stdio';
  private readonly isDisabled = process.env.DISABLE_CONSOLE_OUTPUT === 'true';
  private readonly isHttp = process.env.MCP_MODE === 'http';
  private readonly isTest = process.env.NODE_ENV === 'test' || process.env.TEST_ENVIRONMENT === 'true';

  constructor(config?: Partial<LoggerConfig>) {
    this.config = {
      level: LogLevel.INFO,
      prefix: 'n8n-mcp',
      timestamp: true,
      ...config,
    };
  }

  static getInstance(config?: Partial<LoggerConfig>): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(config);
    }
    return Logger.instance;
  }

  private formatMessage(level: string, message: string): string {
    const parts: string[] = [];
    
    if (this.config.timestamp) {
      parts.push(`[${new Date().toISOString()}]`);
    }
    
    if (this.config.prefix) {
      parts.push(`[${this.config.prefix}]`);
    }
    
    parts.push(`[${level}]`);
    parts.push(message);
    
    return parts.join(' ');
  }

  private writeToFile(message: string, args: any[]): void {
    if (!this.useFileLogging || !this.fileStream) {
      return;
    }

    const inspectOptions = { ...util.inspect.defaultOptions, colors: false };
    const line = util.formatWithOptions(inspectOptions, message, ...args);

    try {
      this.fileStream.write(`${line}\n`);
    } catch (error) {
      this.useFileLogging = false;
      this.fileStream = null;
      this.filePath = null;
      if (process.env.DEBUG === 'true') {
        console.warn('[logger] file logging failed', error);
      }
    }
  }

  private log(level: LogLevel, levelName: string, message: string, ...args: any[]): void {
    // Allow ERROR level logs through in more cases for debugging
    const allowErrorLogs = level === LogLevel.ERROR && (this.isHttp || process.env.DEBUG === 'true');

    const shouldLog = level <= this.config.level || allowErrorLogs;
    if (!shouldLog) {
      return;
    }

    const formattedMessage = this.formatMessage(levelName, message);
    this.writeToFile(formattedMessage, args);

    // Check environment variables before console output
    // In stdio mode, suppress ALL console output to avoid corrupting JSON-RPC (except errors when debugging)
    // Also suppress in test mode unless debug is explicitly enabled
    const shouldConsole =
      !this.isStdio && !this.isDisabled && !(this.isTest && process.env.DEBUG !== 'true');

    if (!shouldConsole && !allowErrorLogs) {
      return;
    }

    // In HTTP mode during request handling, suppress console output (except errors)
    // The ConsoleManager will handle this, but we add a safety check
    if (this.isHttp && process.env.MCP_REQUEST_ACTIVE === 'true' && !allowErrorLogs) {
      // Silently drop the log during active MCP requests (except errors)
      return;
    }

    switch (level) {
      case LogLevel.ERROR:
        console.error(formattedMessage, ...args);
        break;
      case LogLevel.WARN:
        console.warn(formattedMessage, ...args);
        break;
      default:
        console.log(formattedMessage, ...args);
    }
  }

  error(message: string, ...args: any[]): void {
    this.log(LogLevel.ERROR, 'ERROR', message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    this.log(LogLevel.WARN, 'WARN', message, ...args);
  }

  info(message: string, ...args: any[]): void {
    this.log(LogLevel.INFO, 'INFO', message, ...args);
  }

  debug(message: string, ...args: any[]): void {
    this.log(LogLevel.DEBUG, 'DEBUG', message, ...args);
  }

  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  enableFileLogging(options: { directory: string; fileName?: string }): string | null {
    if (this.useFileLogging && this.filePath) {
      return this.filePath;
    }

    try {
      fs.mkdirSync(options.directory, { recursive: true });
      const safeTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = options.fileName ?? `${safeTimestamp}.log`;
      const filePath = path.join(options.directory, fileName);
      this.fileStream = fs.createWriteStream(filePath, { flags: 'a' });
      this.useFileLogging = true;
      this.filePath = filePath;
      return filePath;
    } catch (error) {
      this.useFileLogging = false;
      this.fileStream = null;
      this.filePath = null;
      if (process.env.DEBUG === 'true') {
        console.warn('[logger] unable to enable file logging', error);
      }
      return null;
    }
  }

  async closeFileLogging(): Promise<void> {
    if (!this.fileStream) {
      return;
    }

    const stream = this.fileStream;
    this.fileStream = null;
    this.useFileLogging = false;
    this.filePath = null;

    await new Promise<void>((resolve) => {
      stream.end(() => resolve());
    });
  }

  static parseLogLevel(level: string): LogLevel {
    switch (level.toLowerCase()) {
      case 'error':
        return LogLevel.ERROR;
      case 'warn':
        return LogLevel.WARN;
      case 'debug':
        return LogLevel.DEBUG;
      case 'info':
      default:
        return LogLevel.INFO;
    }
  }
}

// Create a default logger instance
export const logger = Logger.getInstance({
  level: Logger.parseLogLevel(process.env.LOG_LEVEL || 'info'),
});
