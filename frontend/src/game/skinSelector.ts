import { BABYLON } from "@shared/game/gameElements";
import { loadPadddleSkin } from "./paddleSkinLoader";
import enableCanvasExtension from "../utils/canvasExtensionEnabler";

let canvas: HTMLCanvasElement | null = null;
let engine: BABYLON.Engine;
let scene: BABYLON.Scene;
let camera: BABYLON.ArcRotateCamera;
let light: BABYLON.HemisphericLight;

let skinIds: string[] = [];
let modelsCanBeLoaded: boolean = false;

const models: BABYLON.AbstractMesh[] = [];
let currentIndex: number = 0;

// Get the list of skin ids from the server
async function fetchSkinIds(): Promise<void> {
  try {
    const response: Response = await fetch("/api/models/paddles_list");
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data: any = await response.json();

    // Ensure the response is an array
    if (!Array.isArray(data)) {
      console.error("Unexpected data format received:", data);
      return;
    }

    skinIds = data; 

    const storedSkinId: string | null = localStorage.getItem("paddle_skin_id");
    if (storedSkinId && skinIds.includes(storedSkinId)) {
      currentIndex = skinIds.indexOf(storedSkinId);
    }

    // Start loading models only if the scene has been initialized
    if (modelsCanBeLoaded) {
      loadModels();
    }
    modelsCanBeLoaded = true;
  } catch (error: any) {
    console.error("Error fetching skin IDs:", error);
  }
}

fetchSkinIds(); // Retrieve skin IDs immediately

// Load models dynamically
async function loadModels(): Promise<void> {
  // Remove previous model if always in memory
  models.forEach((model: BABYLON.AbstractMesh) => {
    if (model) {
      model.dispose()
    }
  });
  models.length = 0; // Clear the array

  if (!scene) {
    return;
  }

  try {
    // Use Promise.all to fetch all models concurrently
    const results: BABYLON.AbstractMesh[] = await Promise.all(
      skinIds.map((skinId: string) => loadPadddleSkin(skinId, scene))
    );

    // Add all models (or nulls) to the models array
    models.push(...results);
  } catch (error: any) {
    console.error("Error occurred while loading models:", error);
  }
  //console.log(models);

  smoothUpdateCarousel(1, true); // Initial positioning
}

// Create the canvas
export function createSkinSelectorCanvas(root: HTMLElement): void {
  // If a canvas already exists, remove it
  if (canvas) {
    canvas.remove();
    canvas = null;
  }

  canvas = document.createElement("canvas");
  canvas.id = "skinSelectorCanvas";

  enableCanvasExtension(canvas);

  root.appendChild(canvas);
}

const circleRadius: number = 2.5; // Radius of the circle
const angleStep: number = BABYLON.Angle.FromDegrees(25).radians(); // Angular distance between models
const visibleRange: number = BABYLON.Angle.FromDegrees(55).radians(); // Range within which models are visible
// const transitionSpeed: number = 2; // Speed of rotation adjustment
// let targetRotation: number = 0; // Target rotation in radians
// let currentRotation: number = 0; // Current rotation in radians

function smoothUpdateCarousel(deltaTime: number, forceUpdate: boolean = false): void {
  // const angleDiff: number = targetRotation - currentRotation;
  // if (Math.abs(angleDiff) < 0.001 && !forceUpdate) {
  //   return; // Skip updates if the carousel is already aligned
  // }

  // // Gradually interpolate toward the target rotation
  // currentRotation += angleDiff * transitionSpeed * deltaTime;

  // // If the interpolated rotation is approximatly the target one, snap to it
  // if (Math.abs(targetRotation - currentRotation) < 0.001) {
  //   currentRotation = targetRotation;
  // }

  const halfLength: number = Math.floor(models.length / 2);

  models.forEach((model: BABYLON.AbstractMesh, index: number) => {
    // Calculate relative position, allowing for wrapping around
    const relativeIndex: number = (currentIndex - index + models.length + halfLength) % models.length;

    // let rotOffset: number = currentRotation;
    // while (rotOffset > angleStep)
    //     rotOffset -= angleStep;
    // while (rotOffset < 0)
    //     rotOffset += angleStep;
    // rotOffset -= angleStep / 2;

    const modelAngle: number = angleStep * (relativeIndex - halfLength); //+ rotOffset;

    // if (index == currentIndex) {
    //   console.log(BABYLON.Angle.FromDegrees(rotOffset).degrees());
    // }

    // Check if the mesh is within the visible carousel range
    if (Math.abs(modelAngle) <= visibleRange) {
        model.setEnabled(true);

        model.position.y = Math.cos(modelAngle) * circleRadius - circleRadius;
        model.position.z = Math.sin(modelAngle) * circleRadius;
    } else {
      model.setEnabled(false); // Hide model if outside visible range
    }
  });
}

// Function to rotate the carousel to a new index
function rotateCarousel(deltaRotation: -2 | -1 | 1 | 2): void {
  currentIndex = (currentIndex + deltaRotation + models.length) % models.length;
  localStorage.setItem("paddle_skin_id", skinIds[currentIndex]);
  // targetRotation += angleStep * deltaRotation;
  // console.log("currentIndex:", currentIndex);
  smoothUpdateCarousel(1);
}

// Keyboard input for navigation
function handleKeyDown(event: KeyboardEvent): void {
  if (event.key === "ArrowRight") {
    rotateCarousel(1); // Rotate clockwise
  } else if (event.key === "ArrowLeft") {
    rotateCarousel(-1); // Rotate counterclockwise
  }
}

// Mouse control variables
let isMouseDown: boolean = false;
let lastMouseX: number = 0;
let lastMouseY: number = 0;

// Mouse controls for rotating the current model
function handleMouseInput(pointerInfo: BABYLON.PointerInfo): void {
  switch (pointerInfo.type) {
      case BABYLON.PointerEventTypes.POINTERDOWN:
          isMouseDown = true;
          lastMouseX = pointerInfo.event.clientX;
          lastMouseY = pointerInfo.event.clientY;
          break;

      case BABYLON.PointerEventTypes.POINTERUP:
          isMouseDown = false;
          break;

      case BABYLON.PointerEventTypes.POINTERMOVE:
          if (isMouseDown) {
            const currentModel: BABYLON.AbstractMesh = models[currentIndex];
            if (currentModel) {
              const deltaX: number = lastMouseX - pointerInfo.event.clientX;
              const deltaY: number = lastMouseY - pointerInfo.event.clientY;

              // Adjust rotation relative to world axes
              currentModel.rotate(BABYLON.Axis.X, deltaX * 0.01, BABYLON.Space.WORLD);
              currentModel.rotate(BABYLON.Axis.Z, deltaY * -0.01, BABYLON.Space.WORLD);
            }
            lastMouseX = pointerInfo.event.clientX;
            lastMouseY = pointerInfo.event.clientY;
          }
          break;
  }
}

export function initSkinSelector(): void {
  if (!canvas) {
    throw new Error("Canvas element is not created. Call CreateSkinSelectorCanvas() first.");
  }
  if (engine) {
    engine.dispose(); // Dispose of the previous engine if it exists
  }

  engine = new BABYLON.Engine(canvas, true);
  scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.05, 0.05, 0.075, 0.4); // half-transparent skybox
  // scene.clearColor = new BABYLON.Color4(0, 0, 0, 1);

  camera = new BABYLON.ArcRotateCamera(
    "Camera",
    Math.PI, // Horizontal rotation
    0, // Vertical rotation
    2, // Distance from target
    new BABYLON.Vector3(0, 0, 0), // Target position
    scene,
  );
  camera.attachControl(canvas as HTMLElement, false);
  camera.inputs.clear(); // Delete all default camera's inputs

  // Create an hemispheric light
  light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);
  light.intensity = 1.0;

  // new BABYLON.AxesViewer(scene, 1);

  // Register input events
  window.removeEventListener("keydown", handleKeyDown); // Remove existing listener (if any) to prevent duplication
  window.addEventListener("keydown", handleKeyDown);

  scene.onPointerObservable.add(handleMouseInput);

  // Render loop
  engine.runRenderLoop(() => {
    // const deltaTime: number = engine.getDeltaTime() / 1000; // Get the delta time as seconds (default milliseconds)
    // smoothUpdateCarousel(deltaTime);

    scene.render();
  });

  // Add event listener for mouse click
  canvas.addEventListener('click', (event: MouseEvent) => {
    if (!canvas) return;

    // Get the bounding rectangle of the canvas
    const rect: DOMRect = canvas.getBoundingClientRect();

    // Calculate the X position relative to the canvas and
    // Get the percentage of the click position relative to canvas width
    const percentageX: number = (event.clientX - rect.left) / rect.width;

    if (percentageX >= 0 && percentageX < 0.15) {
      rotateCarousel(-2);
    } else if (percentageX >= 0.15 && percentageX < 0.3) {
      rotateCarousel(-1);
    } else if (percentageX >= 0.7 && percentageX < 0.85) {
      rotateCarousel(1);
    } else if (percentageX >= 0.85 && percentageX <= 1) {
      rotateCarousel(2);
    }
  });

  // Resize event
  window.addEventListener("resize", () => {
    if (engine) {
      engine.resize();
    }
  });

  // Start loading models only if the skin ids list has been fetched
  if (modelsCanBeLoaded) {
    loadModels();
  }
  modelsCanBeLoaded = true;
}

export function showSkinSelector(): void {
  if (canvas) {
    // Set visibility to 'visible' to show the canvas
    canvas.style.visibility = "visible";
  }
}

export function hideSkinSelector(): void {
  if (canvas) {
    // Set visibility to 'hidden' to hide the canvas
    canvas.style.visibility = "hidden";
  }
}

export function getSelectedSkinId(): string {
  return skinIds[currentIndex] ?? "0";
}