import Image from "next/image";

export default function ConnectBrand({ admin = false }: { admin?: boolean }) {
  return (
    <>
      <Image
        src="/images/logos/quantt-icon.png"
        alt=""
        width={32}
        height={32}
        className="h-8 w-8"
        priority
      />
      <span className="text-lg font-bold leading-tight tracking-tight text-primary">
        Connect{" "}
        <span className="block text-[11px] font-normal tracking-normal text-copy">by QUANTT</span>
      </span>
      {admin && <span className="ml-1 border-l border-line pl-3 text-xs text-copy">Admin</span>}
    </>
  );
}
