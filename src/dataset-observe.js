// Telemetry is fail-open: it must never change a model response, receipt or order.
export function observeDataset(dataset,type,data){try{if(!dataset?.record||dataset.config?.enabled===false)return false;return dataset.record(type,typeof data==='function'?data():data)??false;}catch{return false;}}
export function observeDatasetError(dataset,error,provider=''){try{dataset?.error(error,provider);}catch{}}
