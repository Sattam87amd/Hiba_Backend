// validationMiddleware.js

export const validateFormData = (req, res, next) => {
    const { firstName, lastName, email, gender, areaOfExpertise, experience } = req.body;
  
    if (!firstName || !lastName || !email || !gender || !areaOfExpertise || !experience) {
      return res.status(400).json({ message: "All fields are required" });
    }
  
    next();
  };
  