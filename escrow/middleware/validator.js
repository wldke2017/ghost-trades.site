const Joi = require('joi');

// Validation schemas
const schemas = {
  // User registration
  register: Joi.object({
    username: Joi.string()
      .alphanum()
      .min(3)
      .max(30)
      .required()
      .messages({
        'string.alphanum': 'Username must only contain alphanumeric characters',
        'string.min': 'Username must be at least 3 characters long',
        'string.max': 'Username cannot exceed 30 characters'
      }),
    password: Joi.string()
      .min(6)
      .required()
      .messages({
        'string.min': 'Password must be at least 6 characters long'
      }),
    role: Joi.string()
      .valid('middleman')
      .required()
  }),

  // User login
  login: Joi.object({
    username: Joi.string().required(),
    password: Joi.string().required()
  }),

  // Create order
  createOrder: Joi.object({
    amount: Joi.number()
      .positive()
      .max(1000000)
      .required()
      .messages({
        'number.positive': 'Amount must be greater than 0',
        'number.max': 'Amount cannot exceed 1,000,000'
      }),
    description: Joi.string()
      .max(1000)
      .allow('', null)
      .messages({
        'string.max': 'Description cannot exceed 1000 characters'
      })
  }),

  // Wallet transaction
  walletTransaction: Joi.object({
    amount: Joi.number()
      .positive()
      .max(1000000)
      .required()
      .messages({
        'number.positive': 'Amount must be greater than 0',
        'number.max': 'Amount cannot exceed 1,000,000'
      })
  }),

  // Transaction request
  transactionRequest: Joi.object({
    amount: Joi.number()
      .positive()
      .max(1000000)
      .required(),
    notes: Joi.string()
      .max(500)
      .allow('', null)
  }),

  // Dispute resolution
  resolveDispute: Joi.object({
    winner: Joi.string()
      .valid('middleman', 'buyer')
      .required()
  }),

  // User status update
  updateUserStatus: Joi.object({
    status: Joi.string()
      .valid('active', 'disabled', 'blocked')
      .required()
  }),

  // Transaction review
  reviewTransaction: Joi.object({
    action: Joi.string()
      .valid('approve', 'reject')
      .required(),
    admin_notes: Joi.string()
      .max(500)
      .allow('', null)
  })
};

// Validation middleware factory
const validate = (schemaName) => {
  return (req, res, next) => {
    const schema = schemas[schemaName];
    
    if (!schema) {
      return res.status(500).json({ error: 'Validation schema not found' });
    }

    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return res.status(400).json({
        error: 'Validation failed',
        details: errors
      });
    }

    // Replace req.body with validated and sanitized data
    req.body = value;
    next();
  };
};

module.exports = { validate, schemas };