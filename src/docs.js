export const generateSwaggerHTML = (specs) => {
  // Validar que specs existe y tiene contenido
  if (!specs || !specs.info) {
    throw new Error('Especificaciones de Swagger no válidas');
  }

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Gestión de Cubiertas - Documentación</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@4.15.5/swagger-ui.css" />
  <style>
    html {
      box-sizing: border-box;
      overflow: -moz-scrollbars-vertical;
      overflow-y: scroll;
    }
    *, *:before, *:after {
      box-sizing: inherit;
    }
    body {
      margin: 0;
      background: #fafafa;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .swagger-ui .topbar {
      display: none;
    }
    .swagger-ui .info {
      margin: 50px 0;
    }
    .loading {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      font-size: 18px;
      color: #666;
    }
    .error {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      font-size: 18px;
      color: #d32f2f;
      flex-direction: column;
    }
  </style>
</head>
<body>
  <div id="swagger-ui">
    <div class="loading">Cargando documentación...</div>
  </div>

  <script src="https://unpkg.com/swagger-ui-dist@4.15.5/swagger-ui-bundle.js" crossorigin></script>
  <script src="https://unpkg.com/swagger-ui-dist@4.15.5/swagger-ui-standalone-preset.js" crossorigin></script>
  <script>
    window.onload = function() {
      try {
        // Validar que SwaggerUIBundle está disponible
        if (typeof SwaggerUIBundle === 'undefined') {
          throw new Error('SwaggerUIBundle no se pudo cargar');
        }

        const spec = ${JSON.stringify(specs, null, 2)};

        // Validar que el spec es válido
        if (!spec || !spec.info) {
          throw new Error('Especificación de API no válida');
        }

        const ui = SwaggerUIBundle({
          spec: spec,
          dom_id: '#swagger-ui',
          deepLinking: true,
          presets: [
            SwaggerUIBundle.presets.apis,
            SwaggerUIStandalonePreset
          ],
          plugins: [
            SwaggerUIBundle.plugins.DownloadUrl
          ],
          layout: "StandaloneLayout",
          persistAuthorization: true,
          displayRequestDuration: true,
          docExpansion: 'none',
          filter: true,
          showExtensions: true,
          showCommonExtensions: true,
          tryItOutEnabled: true,
          requestInterceptor: function(request) {
            // Interceptor para debugging
            console.log('Request:', request);
            return request;
          },
          responseInterceptor: function(response) {
            // Interceptor para debugging
            console.log('Response:', response);
            return response;
          }
        });

        console.log('✅ Swagger UI inicializado correctamente');

      } catch (error) {
        console.error('❌ Error inicializando Swagger UI:', error);
        document.getElementById('swagger-ui').innerHTML = \`
          <div class="error">
            <h2>Error al cargar la documentación</h2>
            <p>\${error.message}</p>
            <p>Por favor, recarga la página o contacta al administrador.</p>
          </div>
        \`;
      }
    };

    // Manejar errores de carga de scripts
    window.onerror = function(msg, url, lineNo, columnNo, error) {
      console.error('Error de script:', { msg, url, lineNo, columnNo, error });
      document.getElementById('swagger-ui').innerHTML = \`
        <div class="error">
          <h2>Error al cargar los recursos</h2>
          <p>No se pudieron cargar los archivos necesarios para la documentación.</p>
          <p>Verifica tu conexión a internet e intenta nuevamente.</p>
        </div>
      \`;
      return true;
    };
  </script>
</body>
</html>
  `;
};
