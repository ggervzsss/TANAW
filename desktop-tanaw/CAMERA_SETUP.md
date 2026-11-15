# Camera Setup implementation and verification

Camera Setup follows the supplied TANAW screenshots: a camera list on the left, selected-camera preview in the center, metrics and controls on the right, and a full-width settings interface with five tabs and a fixed action footer. Dashboard and Reports layouts were not edited for this task.

The Figma connector denied access to the supplied file. The attached screenshots were therefore used for visual alignment; exact Figma font and layer measurements could not be retrieved.

## Behavior

- Information, counting method, monitored area, reconnect policy, and display preferences stay as drafts until Save Changes. Cancel and navigation request confirmation before discarding changes.
- Add Camera starts with the reference information form, then uses the existing camera connection setup. A camera is added only after its real connection test and configuration persistence succeed. Camera Location is optional.
- Connection tests can test a draft address and replacement credentials without changing saved credentials. Electron injects saved credentials for camera starts; saved passwords are never loaded into the renderer.
- Area editing uses the existing normalized polygon and tripwire implementations. Geometry follows the rendered image through resizing. Undo restores individual edits; invalid polygons cannot be applied. Use this Area updates the settings draft; Save Changes sends it to the service.
- Display preferences belong to the selected camera and do not alter counting calculations. Detection boxes and labels can be controlled independently.
- Maintenance reconnects only the selected camera. Diagnostics request current service health and camera runtime data. Restore Defaults modifies the selected camera draft; Remove Camera requires confirmation and persists removal before reporting success.
- A frontend overlay masks startup and reconnect status frames, with distinct connecting, reconnecting, paused, and error presentations. Video and ML image output are not modified for this loading presentation.
- Automatic reconnect defaults to the existing enabled behavior. Disabling it is persisted per camera and stops retries after a connection failure. No database schema changes or migrations were needed.
- Dropdowns use the existing portalled selector and coordinated dismissal. Camera dialogs support Escape, outside clicks, focus containment and restoration, internal scrolling, nested confirmations, and reduced motion.

## Checks

Run from `desktop-tanaw`:

```powershell
npm run type
npm run lint
npm test
npm run build
npx playwright test tests/e2e/browser/camera-setup.spec.ts tests/e2e/browser/open-space.spec.ts --workers=1
npx playwright test tests/e2e/electron/camera-setup.spec.ts --config=playwright.electron.config.ts
```

Run from `desktop-tanaw/ml-service`:

```powershell
.venv/Scripts/python.exe -m pytest tests/test_capture_worker.py tests/test_camera_manager_session.py tests/test_camera_config_validation.py tests/test_local_data_store.py tests/test_pipeline_manager.py tests/test_api_contract.py tests/test_open_space_integration.py -q
```

The browser checks exercise drafts, selected-camera persistence, secure draft-test payloads, both counting methods, area dragging/Undo/validation, resize alignment, display switches, maintenance confirmations, dropdown dismissal, unsaved navigation, connection/storage failures, and preview states. Screenshots are written into each scenario's `test-results` directory. Responsive checks cover 1440, 1024, 760, and 430 pixel widths.

The Electron check launches the actual desktop application in an isolated temporary profile and exercises the real IPC/credential bridge against a test-owned sidecar. Test camera images, counts, credentials, and sidecar responses exist only in test fixtures.

Live RTSP camera connectivity, real-world detection accuracy, and physical camera disconnection/recovery have not been verified with hardware in this session.
