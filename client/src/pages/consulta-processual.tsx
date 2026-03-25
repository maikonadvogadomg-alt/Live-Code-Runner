import React from 'react';

const ConsultaProcessual = ({ modoBusca }) => {
  return (
    <div>
      {modoBusca === 'someCondition' ? <SomeComponent /> : <AnotherComponent />}
    </div>
  );
};

export default ConsultaProcessual;