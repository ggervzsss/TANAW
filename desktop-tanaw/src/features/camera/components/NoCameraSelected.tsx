import { Video } from "lucide-react";

export function NoCameraSelected() {
  return (
    <div className="camera-no-selection">
      <span className="camera-no-selection-icon" aria-hidden="true">
        <Video size={26} />
      </span>
      <h3>No Camera Selected</h3>
      <p>Select a camera from the list or add a new camera to configure its counting settings.</p>
    </div>
  );
}
