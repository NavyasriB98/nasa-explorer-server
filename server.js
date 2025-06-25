const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5050;

// NASA API configuration
const NASA_API_KEY = process.env.NASA_API_KEY || 'DEMO_KEY';
const NASA_BASE_URL = 'https://api.nasa.gov/planetary/apod';

// Rate limiting configuration
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: {
      message: 'Too many requests from this IP, please try again later.',
      type: 'RATE_LIMIT_ERROR'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to all routes
app.use(limiter);

// Middleware
app.use(cors({
  origin: 'https://nasa-explorer-client-lake.vercel.app',
  credentials: true // if you need cookies/auth, otherwise you can omit this line
}));
app.use(express.json());

// Simple request counter
let requestCount = 0;

// Enhanced logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const method = req.method;
  const path = req.path;
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');
  
  console.log(`[${timestamp}] ${method} ${path} - IP: ${ip} - UA: ${userAgent}`);
  
  // Add request ID for tracking
  req.requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  next();
});

// Input validation middleware
const validateDate = (req, res, next) => {
  const { date } = req.params;
  
  if (date) {
    // Check date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Invalid date format. Please use YYYY-MM-DD format.',
          type: 'VALIDATION_ERROR',
          field: 'date'
        }
      });
    }
    
    // Check date range
    const selectedDate = new Date(date);
    const today = new Date();
    const minDate = new Date('1995-06-16');
    
    if (selectedDate > today) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Date cannot be in the future.',
          type: 'VALIDATION_ERROR',
          field: 'date'
        }
      });
    }
    
    if (selectedDate < minDate) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Date must be after June 16, 1995 (APOD start date).',
          type: 'VALIDATION_ERROR',
          field: 'date'
        }
      });
    }
  }
  
  next();
};

// API key validation
const validateAPIKey = (req, res, next) => {
  if (!NASA_API_KEY || NASA_API_KEY === 'DEMO_KEY') {
    console.warn('⚠️ Using DEMO_KEY - Limited to 1000 requests per day');
  }
  next();
};

// Error handling wrapper with enhanced error categorization
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Health check route with enhanced information
app.get('/health', (req, res) => {
  const healthInfo = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'NASA APOD API',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    apiKey: NASA_API_KEY === 'DEMO_KEY' ? 'DEMO_KEY' : 'CUSTOM_KEY',
    requestCount: requestCount,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    requestId: req.requestId
  };
  
  res.json(healthInfo);
});

// APOD route with enhanced error handling
app.get('/api/apod/:date?', validateAPIKey, validateDate, asyncHandler(async (req, res) => {
  requestCount++;
  const { date } = req.params;
  const requestId = req.requestId;
  
  console.log(`🚀 [${requestId}] Fetching APOD for date: ${date || 'today'}`);
  
  try {
    let apiUrl = `${NASA_BASE_URL}?api_key=${NASA_API_KEY}`;
    
    if (date) {
      apiUrl += `&date=${date}`;
    }

    // Add timeout to NASA API request
    const response = await axios.get(apiUrl, {
      timeout: 10000, // 10 second timeout
      headers: {
        'User-Agent': 'NASA-Explorer/1.0'
      }
    });
    
    console.log(`✅ [${requestId}] APOD fetched successfully: ${response.data.title}`);
    
    res.json({
      success: true,
      data: response.data,
      requestId: requestId
    });
    
  } catch (error) {
    console.error(`❌ [${requestId}] Error fetching APOD:`, error.message);
    
    // Categorize errors
    let errorType = 'UNKNOWN_ERROR';
    let statusCode = 500;
    let userMessage = 'An unexpected error occurred while fetching APOD data.';
    
    if (error.code === 'ECONNABORTED') {
      errorType = 'TIMEOUT_ERROR';
      statusCode = 408;
      userMessage = 'Request timeout - NASA API took too long to respond.';
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      errorType = 'NETWORK_ERROR';
      statusCode = 503;
      userMessage = 'Unable to connect to NASA API. Please try again later.';
    } else if (error.response) {
      // NASA API error response
      const nasaStatus = error.response.status;
      const nasaData = error.response.data;
      
      if (nasaStatus === 429) {
        errorType = 'RATE_LIMIT_ERROR';
        statusCode = 429;
        userMessage = 'NASA API rate limit exceeded. Please try again later.';
      } else if (nasaStatus === 400) {
        errorType = 'VALIDATION_ERROR';
        statusCode = 400;
        userMessage = nasaData.error_message || 'Invalid request to NASA API.';
      } else if (nasaStatus === 403) {
        errorType = 'AUTH_ERROR';
        statusCode = 403;
        userMessage = 'Invalid API key or access denied.';
      } else if (nasaStatus >= 500) {
        errorType = 'NASA_SERVER_ERROR';
        statusCode = 503;
        userMessage = 'NASA API is currently unavailable. Please try again later.';
      } else {
        errorType = 'NASA_API_ERROR';
        statusCode = nasaStatus;
        userMessage = nasaData.error_message || `NASA API error: ${nasaStatus}`;
      }
    }
    
    // Log detailed error information
    const errorLog = {
      timestamp: new Date().toISOString(),
      requestId: requestId,
      errorType: errorType,
      statusCode: statusCode,
      message: error.message,
      stack: error.stack,
      nasaResponse: error.response?.data,
      requestUrl: apiUrl
    };
    
    console.error('Detailed error log:', JSON.stringify(errorLog, null, 2));
    
    res.status(statusCode).json({
      success: false,
      error: {
        message: userMessage,
        type: errorType,
        status: statusCode,
        requestId: requestId
      }
    });
  }
}));

// Root route - API documentation and welcome
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Welcome to NASA APOD Explorer API',
    version: '1.0.0',
    endpoints: {
      root: {
        method: 'GET',
        path: '/',
        description: 'API documentation and welcome message'
      },
      health: {
        method: 'GET',
        path: '/health',
        description: 'Health check and server status'
      },
      apod: {
        method: 'GET',
        path: '/api/apod',
        description: 'Get today\'s Astronomy Picture of the Day'
      },
      apodWithDate: {
        method: 'GET',
        path: '/api/apod/:date',
        description: 'Get APOD for a specific date (YYYY-MM-DD format)',
        example: '/api/apod/2024-01-15'
      }
    },
    documentation: {
      dateFormat: 'YYYY-MM-DD',
      minDate: '1995-06-16',
      maxDate: 'Today',
      rateLimit: '100 requests per 15 minutes per IP'
    },
    timestamp: new Date().toISOString(),
    requestId: req.requestId
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: `Route ${req.originalUrl} not found.`,
      type: 'NOT_FOUND_ERROR',
      status: 404
    }
  });
});

// Enhanced error handling middleware
app.use((error, req, res, next) => {
  const errorLog = {
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack
    }
  };
  
  console.error('❌ Unhandled error:', JSON.stringify(errorLog, null, 2));
  
  // Don't expose internal errors in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(500).json({
    success: false,
    error: {
      message: isDevelopment ? error.message : 'Internal server error',
      type: 'INTERNAL_SERVER_ERROR',
      status: 500,
      requestId: req.requestId,
      ...(isDevelopment && { stack: error.stack })
    }
  });
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  process.exit(0);
});

// Unhandled promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

app.listen(PORT, () => {
  console.log(`🚀 NASA APOD Explorer running on port ${PORT}`);
  console.log(`📡 NASA API Key: ${NASA_API_KEY === 'DEMO_KEY' ? 'Using DEMO_KEY (limited)' : 'Using custom key'}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`⏰ Started at: ${new Date().toISOString()}`);
});