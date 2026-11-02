/**
 * GPU-Accelerated WebGL Rendering Engine for Tactical 2D Shooter
 * Hardware-accelerated batch sprite rendering, dynamic lighting, particles, and spatial viewport culling.
 */

class WebGLRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'high-performance' }) ||
              canvas.getContext('experimental-webgl');
    
    this.isSupported = !!this.gl;
    this.shaderProgram = null;
    this.vertexBuffer = null;
    this.texture = null;
    this.texturesLoaded = false;
    this.maxBatchQuads = 4096;
    this.vertexArray = new Float32Array(this.maxBatchQuads * 6 * 6); // x, y, u, v, r, g, b, a
    this.quadCount = 0;

    // Viewport Culling Bounds
    this.viewportAABB = null;

    if (this.isSupported) {
      this.initGL();
      this.preloadAssetCache();
    } else {
      console.warn('[WebGLRenderer] Hardware WebGL not supported, falling back to 2D Canvas context.');
    }
  }

  initGL() {
    const gl = this.gl;

    // Vertex Shader: Fast 2D Orthographic Batching with vertex colors
    const vsSource = `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      attribute vec4 a_color;

      uniform mat4 u_projection;

      varying vec2 v_texCoord;
      varying vec4 v_color;

      void main() {
        gl_Position = u_projection * vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
        v_color = a_color;
      }
    `;

    // Fragment Shader: Texture blend with tint and dynamic illumination
    const fsSource = `
      precision mediump float;

      varying vec2 v_texCoord;
      varying vec4 v_color;

      uniform sampler2D u_texture;
      uniform bool u_useTexture;

      void main() {
        if (u_useTexture) {
          gl_FragColor = texture2D(u_texture, v_texCoord) * v_color;
        } else {
          gl_FragColor = v_color;
        }
      }
    `;

    const vs = this.compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSource);

    this.shaderProgram = gl.createProgram();
    gl.attachShader(this.shaderProgram, vs);
    gl.attachShader(this.shaderProgram, fs);
    gl.linkProgram(this.shaderProgram);

    if (!gl.getProgramParameter(this.shaderProgram, gl.LINK_STATUS)) {
      console.error('[WebGLRenderer] Shader link error:', gl.getProgramInfoLog(this.shaderProgram));
      this.isSupported = false;
      return;
    }

    gl.useProgram(this.shaderProgram);

    // Attribute Locations
    this.attribs = {
      position: gl.getAttribLocation(this.shaderProgram, 'a_position'),
      texCoord: gl.getAttribLocation(this.shaderProgram, 'a_texCoord'),
      color: gl.getAttribLocation(this.shaderProgram, 'a_color')
    };

    // Uniform Locations
    this.uniforms = {
      projection: gl.getUniformLocation(this.shaderProgram, 'u_projection'),
      texture: gl.getUniformLocation(this.shaderProgram, 'u_texture'),
      useTexture: gl.getUniformLocation(this.shaderProgram, 'u_useTexture')
    };

    // Dynamic Vertex Buffer
    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertexArray.byteLength, gl.DYNAMIC_DRAW);

    // Enable Alpha Blending for lighting & particles
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  compileShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('[WebGLRenderer] Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  preloadAssetCache() {
    const gl = this.gl;
    // Create 1x1 white fallback texture for solid color batching
    this.whiteTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.whiteTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.texturesLoaded = true;
  }

  begin(camera, width, height) {
    if (!this.isSupported) return;
    const gl = this.gl;

    gl.viewport(0, 0, width, height);
    gl.clearColor(0.043, 0.067, 0.094, 1.0); // #0b1118 dark sci-fi background
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Compute Camera Orthographic Matrix
    const halfW = (width / 2) / (camera.zoom || 1.0);
    const halfH = (height / 2) / (camera.zoom || 1.0);
    const left = camera.x - halfW;
    const right = camera.x + halfW;
    const top = camera.y - halfH;
    const bottom = camera.y + halfH;

    // Viewport bounding box for spatial frustum culling
    if (window.AABB) {
      this.viewportAABB = new window.AABB(left - 50, top - 50, (right - left) + 100, (bottom - top) + 100);
    }

    // 2D Orthographic Projection Matrix
    const ortho = new Float32Array([
      2 / (right - left), 0, 0, 0,
      0, 2 / (top - bottom), 0, 0,
      0, 0, -1, 0,
      -(right + left) / (right - left), -(top + bottom) / (top - bottom), 0, 1
    ]);

    gl.useProgram(this.shaderProgram);
    gl.uniformMatrix4fv(this.uniforms.projection, false, ortho);
    gl.uniform1i(this.uniforms.useTexture, 0);

    this.quadCount = 0;
  }

  /**
   * Spatial Frustum Culling Check
   * Returns true if entity bounds intersect active camera viewport
   */
  isInViewport(x, y, w = 32, h = 32) {
    if (!this.viewportAABB) return true;
    return (
      x + w >= this.viewportAABB.x &&
      x <= this.viewportAABB.x + this.viewportAABB.w &&
      y + h >= this.viewportAABB.y &&
      y <= this.viewportAABB.y + this.viewportAABB.h
    );
  }

  // Draw hardware-accelerated textured or colored Quad
  drawQuad(x, y, w, h, r, g, b, a = 1.0) {
    if (!this.isSupported) return;
    if (this.quadCount >= this.maxBatchQuads) {
      this.flush();
    }

    // Spatial culling
    if (!this.isInViewport(x, y, w, h)) {
      return;
    }

    const x1 = x, y1 = y;
    const x2 = x + w, y2 = y + h;

    const baseIdx = this.quadCount * 6 * 8; // 6 vertices * 8 floats
    const v = this.vertexArray;

    // 2 Triangles (6 vertices)
    const vertices = [
      x1, y1, 0, 0, r, g, b, a,
      x2, y1, 1, 0, r, g, b, a,
      x1, y2, 0, 1, r, g, b, a,
      x1, y2, 0, 1, r, g, b, a,
      x2, y1, 1, 0, r, g, b, a,
      x2, y2, 1, 1, r, g, b, a
    ];

    for (let i = 0; i < 48; i++) {
      v[baseIdx + i] = vertices[i];
    }

    this.quadCount++;
  }

  // Render high-FPS particle systems on GPU
  drawParticle(x, y, radius, r, g, b, a) {
    this.drawQuad(x - radius, y - radius, radius * 2, radius * 2, r, g, b, a);
  }

  flush() {
    if (!this.isSupported || this.quadCount === 0) return;
    const gl = this.gl;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertexArray.subarray(0, this.quadCount * 48));

    const stride = 8 * 4; // 8 floats * 4 bytes
    gl.enableVertexAttribArray(this.attribs.position);
    gl.vertexAttribPointer(this.attribs.position, 2, gl.FLOAT, false, stride, 0);

    gl.enableVertexAttribArray(this.attribs.texCoord);
    gl.vertexAttribPointer(this.attribs.texCoord, 2, gl.FLOAT, false, stride, 2 * 4);

    gl.enableVertexAttribArray(this.attribs.color);
    gl.vertexAttribPointer(this.attribs.color, 4, gl.FLOAT, false, stride, 4 * 4);

    gl.drawArrays(gl.TRIANGLES, 0, this.quadCount * 6);
    this.quadCount = 0;
  }

  end() {
    if (!this.isSupported) return;
    this.flush();
  }
}

// Universal export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebGLRenderer };
} else {
  window.WebGLRenderer = WebGLRenderer;
}
