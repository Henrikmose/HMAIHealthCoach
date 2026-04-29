// Error Response Handler
// Consistent error formatting across all endpoints

export class APIError extends Error {
  constructor(message, status = 400, code = "ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ============================================
// ERROR RESPONSES
// ============================================

export function errorResponse(message, status = 400, code = "ERROR") {
  return Response.json(
    {
      success: false,
      error: {
        message,
        code,
      },
    },
    { status }
  );
}

export function validationError(errors) {
  return Response.json(
    {
      success: false,
      error: {
        message: "Validation failed",
        code: "VALIDATION_ERROR",
        details: errors,
      },
    },
    { status: 400 }
  );
}

export function authError(message = "Unauthorized") {
  return Response.json(
    {
      success: false,
      error: {
        message,
        code: "AUTH_ERROR",
      },
    },
    { status: 401 }
  );
}

export function notFoundError(resource = "Resource") {
  return Response.json(
    {
      success: false,
      error: {
        message: `${resource} not found`,
        code: "NOT_FOUND",
      },
    },
    { status: 404 }
  );
}

export function conflictError(message) {
  return Response.json(
    {
      success: false,
      error: {
        message,
        code: "CONFLICT",
      },
    },
    { status: 409 }
  );
}

export function serverError(message = "Internal server error") {
  return Response.json(
    {
      success: false,
      error: {
        message,
        code: "SERVER_ERROR",
      },
    },
    { status: 500 }
  );
}

// ============================================
// SUCCESS RESPONSES
// ============================================

export function successResponse(data, message = "Success") {
  return Response.json(
    {
      success: true,
      message,
      data,
    },
    { status: 200 }
  );
}

export function createdResponse(data, message = "Created successfully") {
  return Response.json(
    {
      success: true,
      message,
      data,
    },
    { status: 201 }
  );
}

// ============================================
// ERROR HANDLER WRAPPER
// ============================================

export function handleError(error, functionName) {
  console.error(`[ERROR] ${functionName}:`, error.message);

  if (error instanceof APIError) {
    return errorResponse(error.message, error.status, error.code);
  }

  if (error.code === "PGRST116") {
    return notFoundError("Resource");
  }

  if (error.code === "23505") {
    return conflictError("This item already exists");
  }

  if (error.code === "42P01") {
    return serverError("Database table not found");
  }

  return serverError(error.message || "Something went wrong");
}

export default {
  APIError,
  errorResponse,
  validationError,
  authError,
  notFoundError,
  conflictError,
  serverError,
  successResponse,
  createdResponse,
  handleError,
};