import { SAN_PEDRO_SEAL } from "../utils/loginAssets";

export function LoginBrandHeader() {
  return (
    <div className="mb-10 flex flex-col items-center">
      <img src={SAN_PEDRO_SEAL} alt="San Pedro Seal" className="mb-6 h-24 w-24 object-contain drop-shadow-[0_20px_13px_rgba(0,0,0,0.03)]" />
      <h1 className="text-tanaw-green m-0 font-['Montserrat'] text-3xl font-extrabold tracking-normal max-sm:text-2xl">TANAW PORTAL</h1>
      <p className="mt-1 mb-0 text-[10px] font-bold tracking-[0.3em] text-[#9ca3af] uppercase">San Pedro Tourism Management</p>
    </div>
  );
}
