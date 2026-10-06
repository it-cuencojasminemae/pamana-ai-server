const allowedMediaTypes = [
  'image/*',
  'video/*',
  'audio/*',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.*',
  'text/plain',
  'text/csv',
];

const deniedExecutableTypes = [
  'application/vnd.microsoft.portable-executable',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
  'application/x-dosexec',
  'application/x-sh',
  'text/x-shellscript',
  'application/x-mach-binary',
];

module.exports = ({ env }) => {
  const sameSite = env('SESSION_COOKIE_SAME_SITE', 'lax');
  const secure = env.bool('SESSION_COOKIE_SECURE', env('NODE_ENV', 'development') === 'production');
  if (!['lax', 'strict', 'none'].includes(sameSite)) {
    throw new Error('SESSION_COOKIE_SAME_SITE must be lax, strict or none');
  }
  if (sameSite === 'none' && !secure) {
    throw new Error('Cross-site session cookies require SESSION_COOKIE_SECURE=true');
  }
  return ({
  'users-permissions': {
    config: {
      jwtManagement: 'refresh',
      sessions: {
        httpOnly: true,
        cookie: { sameSite, secure, path: '/' },
      },
    },
  },
  upload: {
    config: {
      security: {
        allowedTypes: allowedMediaTypes,
        deniedTypes: deniedExecutableTypes,
      },
    },
  },
  });
};
