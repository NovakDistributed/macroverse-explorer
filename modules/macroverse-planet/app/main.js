// Go get our 3D library
const THREE = require('three')
// We *should* use ES6 import, but Browserify/budo can't do it by default
// If we require, the "examples" (really THREE's contrib code) expect a global
// THREE and don't see it. So we set that up first.
window.THREE = THREE
// Go get the camera controls
// They install themselves into THREE
require('three/examples/js/controls/OrbitControls.js')

// We will generate "tiles". Each tile is centered on one of its vertices,
// and consists of a trixel subdivided to a certain level, with optionally
// a subtrixel at that level or above left out.

// Get the length of a vector.
function norm3([x, y, z]) {
  return Math.sqrt(x * x + y * y + z * z)
}

// Subtract the second vector from the first.
function sub3([x1, y1, z1], [x2, y2, z2]) {
  return [x1 - x2, y1 - y2, z1 - z2]
}

// Add the second vector to the first
function add3([x1, y1, z1], [x2, y2, z2]) {
  return [x1 + x2, y1 + y2, z1 + z2]
}

// Scale a vector by a scalar
function scale3([x, y, z], s) {
  return [x * s, y * s, z * s]
}

// Cross two vectors
function cross3([x1, y1, z1], [x2, y2, z2]) {
  return [y1 * z2 - z1 * y2, z1 * x2 - x1 * z2, x1 * y2 - y1 * x2]
}

// Find the unit normal on the sphere with the given center, in line with
// the given point
function unit_normal_on_sphere(coord, sphere_center) {
  let coord_sphere_centered = sub3(coord, sphere_center)
  return scale3(coord_sphere_centered, 1/norm3(coord_sphere_centered))
}

// Given a 3D point, snap it to the surface of the sphere with the given
// center and radius.
function snap_to_sphere(coord, sphere_center, radius) {
  // Find point in sphere-centered Cartesian coordinates
  let coord_sphere_centered = sub3(coord, sphere_center)
  // Find how much longer it should be
  let length_scale = radius / norm3(coord_sphere_centered)
  // Rescale it
  let on_sphere_sphere_centered = scale3(coord_sphere_centered, length_scale)
  // Convert to original-origin Cartesian coordinates
  return add3(on_sphere_sphere_centered, sphere_center)
}

// Given a center point and a radius, produce an octahedron.
// The octahedron consists of an array of 8 points.
// Points are laid out as in Szalay et al. 2005 "Indexing the Sphere with
// the Hierarchical Triangular Mesh"
function make_octahedron([x, y, z], radius) {
  return [[x, y, z + radius],
          [x + radius, y, z],
          [x, y + radius, z],
          [x - radius, y, z],
          [x, y - radius, z],
          [x, y, z - radius]]
}

// Get the topology of the octahedron as triangle vertex indices.
// Returns an array of arrays of indices.
// South faces come first, then north.
function make_octahedron_topology() {
  return [[1, 5, 2],
          [2, 5, 3],
          [3, 5, 4],
          [4, 5, 1],
          [1, 0, 4],
          [4, 0, 3],
          [3, 0, 2],
          [2, 0, 1]]
}

// Return the sextet representation of the octahedron corners, in the same
// order as make_octahedron().
function make_basis_sextets() {
  let corners = []
  for (let i = 0; i < 6; i++) {
    let corner = []
    for (let j = 0; j < 6; j++) {
      if (i == j) {
        // Each corenr is 100% itself
        corner.push(1)
      } else {
        corner.push(0)
      }
    }
    corners.push(corner)
  }
  return corners
}

// Get all the vertex positions for a tile with a given number of subdivisions.
// Takes the top-level trixel as integer sextets, its vertex heights, and
// the number of subdivision levels, as well as the corners of the global
// sextet space in 3D (i.e. the octahedron corners). Returns a JavaScript
// array of vertex position components, and a JavaScript array of indexes.
// Needs the current subdivision depth for height generation.
function make_tile([trixel, heights], basis, subdivisions, current_depth) {
  
  // Find the sphere info again
  let sphere_center = scale3(add3(basis[0], basis[5]), 0.5)
  let radius = norm3(sub3(basis[0], basis[5])) / 2
  
  // Vertexes are stored flat, all components next to each other
  let vertex_components = []
  let indices = [] 
  
  // For smooth normals we need all instances of a given vertex to be deduplicated
  let sextet_to_index = {}
  
  /// Get or create the index for the position of a sextet, given that it should be at the given height
  function get_sextet_index(sextet, height) {
    key = '' + sextet
    if (sextet_to_index[key] == undefined) {
      let p = sextet_to_coord3(sextet, basis)
      p = snap_to_sphere(p, sphere_center, radius)
      p = add3(p, scale3(unit_normal_on_sphere(p, sphere_center), (height - 0.5) * radius / 2))
      // Flatten position into vertex buffer
      vertex_components.push(p[0])
      vertex_components.push(p[1])
      vertex_components.push(p[2])
      
      // Record where we put this point for generating indexes for triangles.
      sextet_to_index[key] = (vertex_components.length / 3) - 1
    }
    return sextet_to_index[key]
  }
  
  function recurse([trixel, height_datas], depth) {
    if (depth < current_depth + subdivisions) {
      // Keep recursing
      let children = shatter([trixel, height_datas], depth + 1)
    
      for (let i = 0; i < 4; i++) {
        recurse(children[i], depth + 1)
      }
    } else {
      // Actually generate geometry at the bottom
      for (let i = 0; i < 3; i++) {
        // Only generate one vertex per unique sextet.
        let v_index = get_sextet_index(trixel[i], height_datas[i][0])
        indices.push(v_index)
      }
    }
  }
  
  // Subdivide
  recurse([trixel, heights], current_depth)
  
  return [vertex_components, indices]
}

/// Given a seed, get the seed for the given child number.
function derive_seed(seed, child) {
  // See https://stackoverflow.com/a/52171480
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  h1 = Math.imul(h1 ^ child, 2654435761)
  h2 = Math.imul(h2 ^ child, 1597334677)
  h1 = Math.imul(h1 ^ (h1>>>16), 2246822507) ^ Math.imul(h2 ^ (h2>>>13), 3266489909)
  h2 = Math.imul(h2 ^ (h2>>>16), 2246822507) ^ Math.imul(h1 ^ (h1>>>13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1>>>0)
}

/// Draw a triangle between the given x, y points, in the given color
/// Takes +x = right and +y = up, but converts internally to canvas coordinates
function triangle(c, color) {
  let [c1, c2, c3] = c
  context.beginPath()
  context.moveTo(c1[0], CANVAS_SIZE - c1[1])
  context.lineTo(c2[0], CANVAS_SIZE - c2[1])
  context.lineTo(c3[0], CANVAS_SIZE - c3[1])
  context.closePath()
  
  /*context.lineWidth = 2
  context.strokeStyle = '#666666'
  context.stroke()*/
  
  context.fillStyle = color
  context.fill()
}

// Convert 0-1 float to a hex byte
function to_hex_byte(f) {
  let b = Math.min(255, Math.floor(256 * f)).toString(16)
  if (b.length < 2) {
    b = '0' + b
  }
  return b
}

/// Turn 0-1 floats into a hex color string
function to_hex(rgb) {
  return '#' + to_hex_byte(rgb[0]) +
               to_hex_byte(rgb[1]) +
               to_hex_byte(rgb[2])
}

// We represent points as 3-tuples of integers, where each integer is a weight on one of the vertices.
// The corners are [1, 0, 0], [0, 1, 0], and [0, 0, 1].
// Multiples are equal to the original.
// To move in a direction, double the vector and add 1 in the appropriate channel.

/// Generate 3 vertex seeds and a child seed and store them in the seed structure we use for triangles
function seed_triangle(root_seed) {
  return [derive_seed(root_seed, 0),
          derive_seed(root_seed, 1),
          derive_seed(root_seed, 2),
          derive_seed(root_seed, 3)]
}

/// Interpolate two RGB colors
function clerp(c1, c2, distance) {
  return [c1[0] + (c2[0] - c1[0]) * distance,
          c1[1] + (c2[1] - c1[1]) * distance,
          c1[2] + (c2[2] - c1[2]) * distance]
}

/// Get the midpoint between two 2d points
function midpoint(c1, c2) {
  return [(c1[0] + c2[0])/2, (c1[1] + c2[1])/2]
}

/// Return child triangles 0-3, as point coordinates, from the given parent
/// triangle.
/// Parent is laid out clockwise starting from the lower left.
/// Children are laid out counter-clockwise starting from the parent's
/// vertex, except 3 which is laid out counter-clockwise starting from the
/// upper right.
///   2
///   3
/// 0   1
/// See https://www.microsoft.com/en-us/research/wp-content/uploads/2005/09/tr-2005-123.pdf 
function child_triangle(parent, number) {
  switch (number) {
  case 0:
    return [parent[0], midpoint(parent[0], parent[1]), midpoint(parent[0], parent[2])]
    break;
  case 1:
    return [parent[1], midpoint(parent[1], parent[2]), midpoint(parent[0], parent[1])]
    break;
  case 2:
    return [parent[2], midpoint(parent[0], parent[2]), midpoint(parent[1], parent[2])]
    break;
  case 3:
    return [midpoint(parent[1], parent[2]), midpoint(parent[0], parent[2]), midpoint(parent[0], parent[1])]
    break;
  }
}

/// We represent vertices as integer sextets.
/// They always sum to 2^n, where n is the level of subdivision at chich the vertex first appeared.
/// And to move at a given level, you move one unit from one of the integers to another.
/// This finction takes these coordinates for a triangle, in vertex order,
/// and returns the coordinates for one of the children, reduced to canonical
/// form.
function child_triangle_sextets(parent, number) {
  switch (number) {
  case 0:
    return [parent[0], midpoint_sextets(parent[0], parent[1]), midpoint_sextets(parent[0], parent[2])]
    break;
  case 1:
    return [parent[1], midpoint_sextets(parent[1], parent[2]), midpoint_sextets(parent[0], parent[1])]
    break;
  case 2:
    return [parent[2], midpoint_sextets(parent[0], parent[2]), midpoint_sextets(parent[1], parent[2])]
    break;
  case 3:
    return [midpoint_sextets(parent[1], parent[2]), midpoint_sextets(parent[0], parent[2]), midpoint_sextets(parent[0], parent[1])]
    break;
  }
}

// Return true if the given integer sextet is normalized (has at least one
// non-even coordinate)
function is_normalized(sextet) {
  for (let coord of sextet) {
    if (coord % 2 !== 0) {
      return true
    }
  }
  return false
}

/// Normalize a vertex sextet so it has at least one non-even coordinate.
function normalize_sextet(sextet) {
  while(!is_normalized(sextet)) {
    for (let i = 0; i < sextet.length; i++) {
      sextet[i] /= 2
    }
  }
  return sextet
}

/// Express the given vertex sextet as at the given level
function denormalize_sextet(sextet, level) {
  wanted_total = Math.pow(2, level)
  have_total = sum_sextet(sextet)
  while (have_total < wanted_total) {
    have_total *= 2
    double_sextet_in_place(sextet)
  }
  return sextet
}

// Double all coordinates of a sextet in palce
function double_sextet_in_place(sextet) {
  for (let i = 0; i < sextet.length; i++) {
    sextet[i] *= 2
  }
}

// Return the sum of all sextet coordinates
function sum_sextet(sextet) {
  total = 0
  for (let coord of sextet) {
    total += coord
  }
  return total
}

// Add two sextets component-wise
function add_sextets(t1, t2) {
  let result = []
  for (let i = 0; i < 6; i++) {
    result.push(t1[i] + t2[i])
  }
  return result
}

/// Get the midpoint of two sextets, as a sextet.
/// Tripples are assumed to be adjacent at some level, and normalized.
function midpoint_sextets(t1, t2) {
  // Bring both to the level where they are adjacent
  while (sum_sextet(t1) < sum_sextet(t2)) {
    double_sextet_in_place(t1)
  }
  while (sum_sextet(t1) > sum_sextet(t2)) {
    double_sextet_in_place(t2)
  }
  
  // When they have equal sums, they differ along a pair of dimensions by 1.
  // We can just sum them and normalize again
  return normalize_sextet(add_sextets(t1, t2))
}

// Given an integer sextet, and 6 basis N-dimensional coordinate points,
// interpolate an N-dimensional point.
function sextet_to_coord(sextet, basis, dimensions) {
  to_return = []
  for (let i = 0; i < dimensions; i++) {
    // For each coord dimension
    let total_weight = 0;
    let value = 0
    for (let j = 0; j < 6; j++) {
      // For each point to weight
      // Record the weight
      total_weight += sextet[j]
      // Weigh in the point
      value += sextet[j] * basis[j][i]
    }
    // Average
    value /= total_weight
    to_return.push(value)
  }
  return to_return
}

function sextet_to_coord3(sextet, basis) {
  return sextet_to_coord(sextet, basis, 3)
}


/// Given the seed of a triangle, get the offsets for all the child triangles.
function child_offsets(seed) {
  // Compute base offsets
  let offsets = [seed_to_float(derive_seed(seed, 0)),
                 seed_to_float(derive_seed(seed, 1)),
                 seed_to_float(derive_seed(seed, 2)),
                 seed_to_float(derive_seed(seed, 3))]
                 
  // Average
  let average = (offsets[0] + offsets[1] + offsets[2] + offsets[3])/4
  
  // Subtract average
  offsets[0] -= average
  offsets[1] -= average
  offsets[2] -= average
  offsets[3] -= average
  
  return offsets
}

// Compute the height data for a point, given two neighbor height datas, a
// noise value from 0 to 1, and a depth value counting up as we get to finer
// levels of detail. A height data is an array where the 0th element is the
// actual final vertex height, and the other values are controlled by this
// function (except that a single-element array must be accepted at depth 0).
function compute_point_height_data(neighbor1, neighbor2, noise, depth) {
  
  if (neighbor1.length == 1) {
    neighbor1 = [neighbor1[0], neighbor1[0]]
  }
  if (neighbor2.length == 1) {
    neighbor2 = [neighbor2[0], neighbor2[0]]
  }
  
  let fractal_noise = add_noise((neighbor1[1] + neighbor2[1]) / 2, noise - 0.5, depth)

  return [Math.pow(fractal_noise, 1.5), fractal_noise]
}

/// Given a trixel (as sextets) and vertex height data (3 arrays where
/// height is 0) return an array of 4 similar structures for the 
/// child trixels
function shatter(trixel_heights, depth) {
  let [parent, height_datas] = trixel_heights
  
  // Number the midpoints as in the paper
  let midpoints = [midpoint_sextets(parent[1], parent[2]),
                   midpoint_sextets(parent[0], parent[2]),
                   midpoint_sextets(parent[0], parent[1])]
                   
  // Define which neighbors to interpolate for each point
  let neighbors = [[1, 2], [0, 2], [0, 1]]
  
  let midpoint_height_datas = []
  for (let i = 0; i < 3; i++) {
    // Compute all the height datas
    midpoint_height_datas.push(compute_point_height_data(height_datas[neighbors[i][0]], height_datas[neighbors[i][1]],
                                                         seed_to_float(sextet_to_seed(midpoints[i])), depth))
  }
  
  // Return a bunch of triangles and height datas.
  return [[[parent[0], midpoints[2], midpoints[1]], [height_datas[0], midpoint_height_datas[2], midpoint_height_datas[1]]],
          [[parent[1], midpoints[0], midpoints[2]], [height_datas[1], midpoint_height_datas[0], midpoint_height_datas[2]]],
          [[parent[2], midpoints[1], midpoints[0]], [height_datas[2], midpoint_height_datas[1], midpoint_height_datas[0]]],
          [[midpoints[0], midpoints[1], midpoints[2]], [midpoint_height_datas[0], midpoint_height_datas[1], midpoint_height_datas[2]]]]
}

const BASE_SEED = 7

/// Get a seed for computing the height of a normalized sextet.
function sextet_to_seed(sextet) {
  str = '' + sextet
  
  seed = BASE_SEED
  
  for (let i = 0; i < str.length; i++) {
    seed = derive_seed(seed, str.charCodeAt(i))
  }
  
  return seed
}

/// Generate a 0-1 float from the given seed
function seed_to_float(seed) {
  // See https://stackoverflow.com/a/65793426
  // Robert Jenkins’ 32 bit integer hash function
  seed = ((seed + 0x7ED55D16) + (seed << 12))  & 0xFFFFFFFF;
  seed = ((seed ^ 0xC761C23C) ^ (seed >>> 19)) & 0xFFFFFFFF;
  seed = ((seed + 0x165667B1) + (seed << 5))   & 0xFFFFFFFF;
  seed = ((seed + 0xD3A2646C) ^ (seed << 9))   & 0xFFFFFFFF;
  seed = ((seed + 0xFD7046C5) + (seed << 3))   & 0xFFFFFFFF;
  seed = ((seed ^ 0xB55A4F09) ^ (seed >>> 16)) & 0xFFFFFFFF;
  return (seed & 0xFFFFFFF) / 0x10000000;
}

/// Mix in a level of fractal noise (value) on top of base level base at depth depth
function add_noise(base, value, depth) {
  return Math.min(1, Math.max(0, base + value / Math.pow(2, depth)))
}

/// Get the hex color at a given height
function color_at(height) {
  const WATER_TO_BEACH = 0.35
  const BEACH_TO_LAND = 0.37
  const LAND_TO_MOUNTAIN = 0.4

  if (height < WATER_TO_BEACH) {
    // Water
    return to_hex(clerp([0, 0, 0.5], [0, 0, 1], height / WATER_TO_BEACH))
  } else if (height >= WATER_TO_BEACH && height < BEACH_TO_LAND) {
    // Beach
    return to_hex(clerp([0, 0, 1], [1, 204/255, 102/255], (height - WATER_TO_BEACH) / (BEACH_TO_LAND - WATER_TO_BEACH)))
  } else if (height >= BEACH_TO_LAND && height < LAND_TO_MOUNTAIN) {
    // Ground
    return to_hex(clerp([1, 204/255, 102/255], [0, 1, 0.1], (height - BEACH_TO_LAND) / (LAND_TO_MOUNTAIN - BEACH_TO_LAND)))
  } else { 
    // Mountain
    return to_hex(clerp([0, 1, 0.1], [0.5, 0.5, 0.5], (height - LAND_TO_MOUNTAIN) / (1.0 - LAND_TO_MOUNTAIN)))
  }
}

window.addEventListener('load', () => {
  let canvasElement = document.querySelector("#myCanvas")
  let gl = canvasElement.getContext("webgl2")

  const CANVAS_SIZE = canvasElement.width
  const SHOW_NORMALS = false
  const SHOW_WIREFRAME = false

  // Define the octahedron corners
  let basis = make_octahedron([0, 0, 0], 1)
  let basis_sextets = make_basis_sextets()
  let topology = make_octahedron_topology()

  let planet = new THREE.Group()

  const PLANET_FRAGMENT_SHADER = `
    in vec3 vWorldPosition;
    in vec3 vNormal;
    
    // TODO: A bunch of this light stuff is copied from random three.js
    // shader files because they don't define a real documented interface.
    uniform vec3 ambientLightColor;
    struct DirectionalLight {
      vec3 direction;
      vec3 color;
    };
    uniform DirectionalLight directionalLights[NUM_DIR_LIGHTS];
    // TODO: Directional light direction needs to respect camera matrices: vertex shader?
    
    void main() {
      vec3 ambientMaterial = vec3(1, 1, 1);
      vec3 diffuseMaterial = ambientMaterial;
      vec3 specularMaterial = vec3(0, 0, 0);
      
      vec3 color;
      
      for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
        // Basic logic is taken from https://stackoverflow.com/questions/38210386
        vec3 fromLight = normalize(directionalLights[0].direction);
        vec3 toLight = -fromLight;
        vec3 reflectLight = reflect(toLight, vNormal);

        float litness = dot(toLight, vNormal);
        float reflectness = max(0.0, dot(reflectLight, vNormal));
        
        color += ambientMaterial * ambientLightColor;
        color += diffuseMaterial * directionalLights[0].color * litness;
        color += specularMaterial * directionalLights[0].color * reflectness;
      }
    
      gl_FragColor = vec4(color, 1);
    }
  `

  const PLANET_VERTEX_SHADER = `
    out vec3 vWorldPosition;
    out vec3 vNormal;
    
    void main() {

      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      
      vNormal = normal;

      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

    }
  `

  // Add the lighting uniforms to any custom planet material uniforms
  // TODO: Uniforms should include which trixel this tile is maybe?
  let tile_uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, {}])

  let tile_material = SHOW_NORMALS ? new THREE.MeshNormalMaterial() : 
      /*new THREE.ShaderMaterial({
        vertexShader: PLANET_VERTEX_SHADER, 
        fragmentShader: PLANET_FRAGMENT_SHADER, 
        uniforms: tile_uniforms, 
        lights: true
      })*/
      new THREE.MeshStandardMaterial({
        color: 0xFF0000,
        // Use face normals to shade
        flatShading: true
      })
      
      
  let root_height_datas = []
  for (let i = 0; i < 8; i++) {
    // Generate the heights of the original 8 corners.
    root_height_datas.push(compute_point_height_data([0.5], [0.5], seed_to_float(sextet_to_seed(basis_sextets[i])), 0))
  }

  for (let root_indices of topology) {
    // For each three vertices that form a face
    
    // Define the root trixel as a sextet
    let root = [basis_sextets[root_indices[0]],
                basis_sextets[root_indices[1]],
                basis_sextets[root_indices[2]]]
    
    let here = [root, [root_height_datas[root_indices[0]],
                       root_height_datas[root_indices[1]],
                       root_height_datas[root_indices[2]]]]
    let depth = 0
    
    let [vertex_components, indices] = make_tile(here, basis, 8, 0)
    let tile_geometry = new THREE.BufferGeometry()
    tile_geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertex_components), 3))
    //tile_geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normal_components), 3))
    tile_geometry.setIndex(indices)
    // Give it some normals
    tile_geometry.computeFaceNormals()
    tile_geometry.computeVertexNormals()
    
    let tile_node = new THREE.Group()
    let tile_faces = new THREE.Mesh(tile_geometry, tile_material)
    tile_node.add(tile_faces)
    
    let tile_wireframe_geometry = new THREE.WireframeGeometry(tile_geometry)
    let tile_lines = new THREE.LineSegments(tile_wireframe_geometry)
    tile_lines.material.color = {r: 1, g: 0, b: 0}
    tile_lines.material.linewidth = 3
    tile_lines.material.depthTest = false
    tile_lines.material.opacity = 0.25
    tile_lines.material.transparent = true
    if (SHOW_WIREFRAME) {
      tile_node.add(tile_lines)
    }
    
    planet.add(tile_node)
  }

  let scene = new THREE.Scene()

  scene.add(planet)

  let light = new THREE.DirectionalLight(0xffffee, 0.5)
  light.position.x = -5
  light.position.y = 0
  light.position.z = 2
  light.target = planet
  let light_arm = new THREE.Group()
  light_arm.add(light)
  scene.add(light_arm)

  let ambient = new THREE.AmbientLight(0x101010)
  scene.add(ambient)

  let camera = new THREE.PerspectiveCamera(75, CANVAS_SIZE / CANVAS_SIZE, 0.1, 10000)

  let renderer = new THREE.WebGLRenderer({context: gl})
  renderer.setSize(CANVAS_SIZE, CANVAS_SIZE)

  camera.position.z = 3
  camera.position.x = 0
  camera.position.y = 0

  // Orbit controls come from their own file
  let controls = new THREE.OrbitControls(camera, canvasElement)
  controls.update()

  let time = 0
  function animate() {
    time += 0.001 
    try {
      light_arm.rotation.y += 0.001
      renderer.render(scene, camera)
      requestAnimationFrame(animate)
    } catch (e) {
      console.error(e)
    }
  }

  animate()
})
