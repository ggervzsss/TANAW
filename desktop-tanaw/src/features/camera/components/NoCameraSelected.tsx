import { Video } from "lucide-react";
import { Card } from "../../../components/Card";

export function NoCameraSelected() {
  return (
    <Card className="flex h-full min-h-0 flex-col items-center justify-center border-2 border-dashed border-gray-300 bg-transparent p-8 shadow-none">
      <Video size={48} className="mb-4 text-gray-300" />
      <h3 className="text-lg font-bold text-gray-500">No Camera Selected</h3>
      <p className="mt-2 max-w-sm text-center text-sm text-gray-400">Select a node from the list or add a new camera to configure its edge processing properties.</p>
    </Card>
  );
}
