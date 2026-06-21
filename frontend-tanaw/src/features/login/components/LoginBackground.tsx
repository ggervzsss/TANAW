import { CITY_HALL_IMAGE } from "../utils/loginAssets";

export function LoginBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
      <img src={CITY_HALL_IMAGE} alt="" className="h-full w-full object-cover object-center" />
      <div className="absolute inset-0 bg-[rgba(5,91,37,0.85)] mix-blend-multiply" />
    </div>
  );
}
