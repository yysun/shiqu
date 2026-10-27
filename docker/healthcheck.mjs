try{
 const response=await fetch(`http://127.0.0.1:${process.env.PORT||3000}/api/stories`,{signal:AbortSignal.timeout(4000)});
 const data=await response.json();
 process.exit(response.ok&&Array.isArray(data)?0:1);
}catch{process.exit(1);}
