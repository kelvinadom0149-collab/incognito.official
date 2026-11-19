export default function ProductAvailabilityBadge({quantity}:{quantity:number}){
  if(quantity<=0)return <span className="badge out">Sold Out</span>;
  if(quantity===1)return <span className="badge">Only 1 Left</span>;
  return <span className="badge">In Stock ({quantity} available)</span>;
}
